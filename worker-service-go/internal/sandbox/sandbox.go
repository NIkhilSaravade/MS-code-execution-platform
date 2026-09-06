// Package sandbox orchestrates the execution of untrusted user code inside a
// hardened Kubernetes Pod. Every security control described in the k3s
// migration design note is enforced here. Any code path that weakens these
// controls must be documented explicitly and reviewed carefully.
//
// Architecture (replaces the old Docker-outside-of-Docker sibling-container
// design entirely): one Pod is checked out of a pre-warmed, per-language pool
// for the lifetime of a SUBMISSION (not one Pod per test case) - the worker
// execs into it once to compile, then once per test case to run, then deletes
// it. Never reused across submissions. See NewSession/Session below.
package sandbox

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/domain"
)

const (
	// maxOutputBytesDefault is the hard cap on combined stdout+stderr returned
	// to the worker. Submissions that produce more are truncated and flagged.
	maxOutputBytesDefault = 512 * 1024 // 512 KB

	// compilationTimeoutMultiplier gives compilation a proportionally longer
	// wall-clock timeout than execution.
	compilationTimeoutMultiplier = 3

	// minCompileTimeout is a floor under compilationTimeoutMultiplier*wallTimeout.
	minCompileTimeout = 15 * time.Second

	// sandboxContainerName is the name of the single container in every
	// pooled sandbox Pod.
	sandboxContainerName = "sandbox"
)

// --------------------------------------------------------------------------
// Language descriptors
// --------------------------------------------------------------------------

// langDescriptor holds the container image and the commands needed to
// compile (optional) and run code in a given language, inside the sandbox pod.
type langDescriptor struct {
	Image          string
	CompileCmd     []string
	ExecCmd        []string
	SourceFilename string
	// Env holds extra "KEY=VALUE" environment variables for this language's
	// pod. Only Go currently needs this (GOCACHE/HOME/GOMAXPROCS/GOFLAGS).
	Env []string
	// CPUQuota overrides cfg.SandboxCPUQuota for this language's pool only.
	// Zero means "use the platform-wide default" - see cfg.SandboxCPUQuotaGo
	// for why Go alone needs a higher tier.
	CPUQuota float64
}

func buildLangDescriptors(cfg *config.Config, images map[string]string) map[domain.Language]*langDescriptor {
	return map[domain.Language]*langDescriptor{
		domain.LangPython: {
			Image:          images["python"],
			ExecCmd:        []string{"python3", "/sandbox/solution.py"},
			SourceFilename: "solution.py",
			CPUQuota:       cfg.SandboxCPUQuotaPython,
		},
		domain.LangJava: {
			Image:          images["java"],
			CompileCmd:     []string{"javac", "/sandbox/Main.java"},
			ExecCmd:        []string{"java", "-cp", "/sandbox", "Main"},
			SourceFilename: "Main.java",
			CPUQuota:       cfg.SandboxCPUQuotaJava,
		},
		domain.LangCPP: {
			Image:          images["cpp"],
			CompileCmd:     []string{"g++", "-std=c++17", "-O2", "-o", "/sandbox/solution", "/sandbox/solution.cpp"},
			ExecCmd:        []string{"/sandbox/solution"},
			SourceFilename: "solution.cpp",
		},
		domain.LangC: {
			Image:          images["c"],
			CompileCmd:     []string{"gcc", "-std=c11", "-O2", "-o", "/sandbox/solution", "/sandbox/solution.c", "-lm"},
			ExecCmd:        []string{"/sandbox/solution"},
			SourceFilename: "solution.c",
		},
		domain.LangJavaScript: {
			Image:          images["javascript"],
			ExecCmd:        []string{"node", "/sandbox/solution.js"},
			SourceFilename: "solution.js",
			CPUQuota:       cfg.SandboxCPUQuotaJavaScript,
		},
		domain.LangTypeScript: {
			Image:          images["typescript"],
			CompileCmd:     []string{"tsc", "--target", "es2016", "--module", "commonjs", "/sandbox/solution.ts"},
			ExecCmd:        []string{"node", "/sandbox/solution.js"},
			CPUQuota:       cfg.SandboxCPUQuotaTypeScript,
			SourceFilename: "solution.ts",
		},
		domain.LangGo: {
			Image: images["go"],
			// GOTMPDIR must already exist as a directory - unlike GOCACHE,
			// Go's toolchain does not create it, it only stats it
			// ("go: creating work dir: stat /sandbox/.gotmp: no such file or
			// directory"). Routing the compile through a shell lets us
			// mkdir -p both dirs before go build ever runs.
			CompileCmd:     []string{"sh", "-c", "mkdir -p /sandbox/.gocache /sandbox/.gotmp && go build -o /sandbox/solution /sandbox/solution.go"},
			ExecCmd:        []string{"/sandbox/solution"},
			SourceFilename: "solution.go",
			// GOCACHE/GOTMPDIR/HOME must NOT point at /tmp: that volume is a
			// tiny 64Mi memory-backed, noexec tmpfs (see podspec.go) sized for
			// languages that barely touch it, not for Go's build cache - and
			// since sandbox pods are pooled and reused across many
			// submissions, GOCACHE only grows, eventually exhausting it
			// ("no space left on device", surfaced as an empty-reason CE
			// because that failure prints to go build's stdout, which the
			// compile step doesn't capture - see Session.NewSession).
			// /sandbox (the "scratch" emptyDir) has no size limit and is
			// backed by the node's overlay disk, so it's the correct place.
			//
			// GOPROXY/GOSUMDB default to proxy.golang.org/sum.golang.org,
			// which need network access Go assumes is there even for a
			// dependency-free single file - the sandbox pod has none (by
			// design, see the NetworkPolicy note atop podspec.go), so every
			// build wasted 20-30s on doomed DNS lookups (multiplied by
			// Kubernetes' DNS search-domain suffixes) before falling through
			// to actually compiling. That routinely blew past the compile
			// step's own timeout, killing `go build` before it printed
			// anything - an empty-output CE with no diagnostic to go on,
			// confirmed live: 34.68s with these unset vs. 0.61s with them
			// off. Since nothing here ever has real dependencies to fetch,
			// disabling both outright is correct, not just a workaround.
			Env:      []string{"GOCACHE=/sandbox/.gocache", "GOTMPDIR=/sandbox/.gotmp", "HOME=/sandbox", "GOMAXPROCS=1", "GOFLAGS=-p=1", "GOPROXY=off", "GOSUMDB=off"},
			CPUQuota: cfg.SandboxCPUQuotaGo,
		},
	}
}

// --------------------------------------------------------------------------
// RunResult
// --------------------------------------------------------------------------

// RunResult is the outcome of one test case run inside the sandbox.
type RunResult struct {
	Stdout          []byte
	Stderr          []byte
	ExitCode        int
	WallTimeMS      int64
	CPUTimeMS       int64 // not populated - see the old sandbox.go, this was never set there either
	MaxMemoryKB     int64
	TimedOut        bool
	OOMKilled       bool
	StdoutTruncated bool
	StderrTruncated bool

	// CompileError/CompileOutput are always zero-value on a RunResult -
	// compilation now happens once per submission at session creation (see
	// Session.CompileError), not once per test case. Kept here only so
	// VerdictFromResult's switch doesn't need two near-identical shapes.
	CompileError  bool
	CompileOutput []byte
}

// --------------------------------------------------------------------------
// Sandbox
// --------------------------------------------------------------------------

// Sandbox executes untrusted code inside pooled, hardened Kubernetes Pods.
// Safe for concurrent use.
type Sandbox struct {
	cfg       *config.Config
	langs     map[domain.Language]*langDescriptor
	restCfg   *rest.Config
	clientset *kubernetes.Clientset

	poolMu sync.Mutex
	pools  map[domain.Language]*pool

	bgCtx    context.Context
	bgCancel context.CancelFunc

	outputCapBytes int
}

// New creates a Sandbox and its Kubernetes client. bgCtx bounds the lifetime
// of the pool-replenishment goroutines - callers should derive it from the
// same context that's cancelled on graceful shutdown.
func New(bgCtx context.Context, cfg *config.Config) (*Sandbox, error) {
	restCfg, clientset, err := buildK8sClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("build kubernetes client: %w", err)
	}

	cap := cfg.SandboxOutputCapKB * 1024
	if cap <= 0 {
		cap = maxOutputBytesDefault
	}

	ctx, cancel := context.WithCancel(bgCtx)
	return &Sandbox{
		cfg:            cfg,
		langs:          buildLangDescriptors(cfg, cfg.LanguageImages),
		restCfg:        restCfg,
		clientset:      clientset,
		pools:          make(map[domain.Language]*pool),
		bgCtx:          ctx,
		bgCancel:       cancel,
		outputCapBytes: cap,
	}, nil
}

// Close stops all pool-replenishment goroutines. Does not drain/delete
// currently-idle pooled pods - those are cluster garbage the operator can
// sweep on redeploy; not worth blocking process shutdown on.
func (s *Sandbox) Close() {
	s.bgCancel()
}

// --------------------------------------------------------------------------
// Session — one Kubernetes Pod checked out for the life of one submission
// --------------------------------------------------------------------------

// SessionRequest describes the submission a Session will execute.
type SessionRequest struct {
	Language      domain.Language
	SourceCode    []byte
	WallTimeout   time.Duration // sizes the compile-step timeout; also the default per-test-case timeout
	MemoryLimitMB int
	CPUQuota      float64
}

// Session is one checked-out sandbox Pod, live for exactly one submission.
// Compile once, then RunTestCase once per test case, then Close.
//
// NOTE (known simplification, flagged to the user): pooled pods are created
// ahead of time sized to cfg.SandboxMemoryMB/cfg.SandboxCPUQuota uniformly -
// MemoryLimitMB/CPUQuota on the request aren't yet used to select a
// differently-sized pod (there's no per-pod resize after creation). A
// follow-up would bucket the pool by a small set of resource tiers if
// per-problem limits need to diverge meaningfully from the platform default.
type Session struct {
	sandbox *Sandbox
	lang    domain.Language
	desc    *langDescriptor
	podName string

	// CompileError/CompileOutput are set once at session creation (compiled
	// languages only) - the caller should treat every test case as CE
	// without calling RunTestCase at all when CompileError is true.
	CompileError  bool
	CompileOutput []byte
}

// isPodGoneErr reports whether err looks like "the pod no longer exists".
// The exec subresource surfaces this as a plain "pods \"x\" not found"
// message during the SPDY upgrade handshake rather than as a typed API
// error the normal REST response decoder would produce, so a string check
// is the reliable signal available here.
func isPodGoneErr(err error) bool {
	return err != nil && strings.Contains(err.Error(), "not found")
}

// NewSession checks out a pod from the language's pool (or creates one
// on-demand if the pool is empty), writes the source file into it, and runs
// the compile step if the language needs one.
func (s *Sandbox) NewSession(ctx context.Context, req *SessionRequest) (*Session, error) {
	ctx, span := otel.Tracer("worker-service/sandbox.Sandbox").Start(ctx, "sandbox.NewSession")
	defer span.End()
	span.SetAttributes(attribute.String("language", string(req.Language)))

	desc, ok := s.langs[req.Language]
	if !ok {
		return nil, fmt.Errorf("unsupported language: %s", req.Language)
	}

	p := s.getOrCreatePool(req.Language, desc)
	podName, err := p.checkout(ctx)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("checkout sandbox pod: %w", err)
	}

	srcPath := "/sandbox/" + desc.SourceFilename
	if err := writeFileToPod(ctx, s.restCfg, s.clientset, s.cfg.K8sNamespace, podName, sandboxContainerName, srcPath, req.SourceCode); err != nil {
		if !isPodGoneErr(err) {
			_ = s.deletePod(context.Background(), podName)
			return nil, fmt.Errorf("write source into sandbox pod: %w", err)
		}
		// checkout() already confirms a pod is Running before handing it
		// back (see pool.go), but it can still die in the narrow window
		// between that check and this write - eviction, OOM-kill, or a
		// manual `kubectl delete pods --all -n sandbox-execution` (this is
		// exactly the SYSTEM_ERROR users saw: "pods ... not found"). One
		// retry against a guaranteed-fresh, on-demand pod turns that race
		// into a slightly slower submission instead of a failed one.
		log.Warn().Str("language", string(req.Language)).Str("pod", podName).Err(err).
			Msg("sandbox: pod died before source could be written, retrying with a fresh pod")
		podName, err = s.createPod(ctx, desc, req.Language)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			return nil, fmt.Errorf("checkout sandbox pod: %w", err)
		}
		if err := writeFileToPod(ctx, s.restCfg, s.clientset, s.cfg.K8sNamespace, podName, sandboxContainerName, srcPath, req.SourceCode); err != nil {
			_ = s.deletePod(context.Background(), podName)
			return nil, fmt.Errorf("write source into sandbox pod: %w", err)
		}
	}

	sess := &Session{sandbox: s, lang: req.Language, desc: desc, podName: podName}

	if desc.CompileCmd != nil {
		compileTimeout := max(req.WallTimeout*compilationTimeoutMultiplier, minCompileTimeout)
		compileCtx, cancel := context.WithTimeout(ctx, compileTimeout)
		var stdoutBuf, stderrBuf cappedBuffer
		stdoutBuf.cap = s.outputCapBytes / 2
		stderrBuf.cap = s.outputCapBytes / 2
		exitCode, timedOut, execErr := execInPod(compileCtx, s.restCfg, s.clientset, s.cfg.K8sNamespace, podName, sandboxContainerName, desc.CompileCmd, nil, &stdoutBuf, &stderrBuf)
		cancel()
		if execErr != nil {
			sess.Close()
			span.RecordError(execErr)
			span.SetStatus(codes.Error, execErr.Error())
			return nil, fmt.Errorf("run compile step: %w", execErr)
		}
		if timedOut || exitCode != 0 {
			sess.CompileError = true
			// Combine both streams: most compilers report diagnostics on
			// stderr, but some toolchain-level failures (e.g. `go build`
			// reporting "no space left on device" while copying the linked
			// binary into place) print to stdout instead - a stderr-only
			// capture silently drops those, surfacing as an empty-reason CE
			// with no way to diagnose it short of live pod reproduction.
			var combined []byte
			combined = append(combined, stdoutBuf.Bytes()...)
			if len(combined) > 0 && stderrBuf.buf.Len() > 0 {
				combined = append(combined, '\n')
			}
			combined = append(combined, stderrBuf.Bytes()...)
			sess.CompileOutput = combined
		}
	}

	span.SetAttributes(attribute.Bool("compile_error", sess.CompileError))
	return sess, nil
}

// RunTestCase execs the language's run command into the session's pod,
// piping stdin and capturing stdout/stderr, with a host-enforced wall-clock
// timeout (same guarantee as the old Docker design: a compromised process
// inside the pod cannot disable this by ignoring its own signal handling,
// since the exec stream itself is torn down on context cancellation).
func (sess *Session) RunTestCase(ctx context.Context, stdin []byte, wallTimeout time.Duration) (*RunResult, error) {
	s := sess.sandbox
	ctx, span := otel.Tracer("worker-service/sandbox.Sandbox").Start(ctx, "sandbox.RunTestCase")
	defer span.End()
	span.SetAttributes(
		attribute.String("language", string(sess.lang)),
		attribute.Int("stdin_bytes", len(stdin)),
		attribute.Int64("wall_timeout_ms", wallTimeout.Milliseconds()),
	)

	runCtx, cancel := context.WithTimeout(ctx, wallTimeout)
	defer cancel()

	var stdoutBuf, stderrBuf cappedBuffer
	stdoutBuf.cap = s.outputCapBytes / 2
	stderrBuf.cap = s.outputCapBytes / 2

	memCtx, stopMem := context.WithCancel(ctx)
	memCh := make(chan int64, 1)
	go sampleContainerPeakMemoryKB(memCtx, s.restCfg, s.clientset, s.cfg.K8sNamespace, sess.podName, s.cfg.SandboxMemSamplePeriod, memCh)

	var stdinReader *bytes.Reader
	if len(stdin) > 0 {
		stdinReader = bytes.NewReader(stdin)
	}

	start := time.Now()
	var exitCode int
	var timedOut bool
	var err error
	if stdinReader != nil {
		exitCode, timedOut, err = execInPod(runCtx, s.restCfg, s.clientset, s.cfg.K8sNamespace, sess.podName, sandboxContainerName, sess.desc.ExecCmd, stdinReader, &stdoutBuf, &stderrBuf)
	} else {
		exitCode, timedOut, err = execInPod(runCtx, s.restCfg, s.clientset, s.cfg.K8sNamespace, sess.podName, sandboxContainerName, sess.desc.ExecCmd, nil, &stdoutBuf, &stderrBuf)
	}
	stopMem()
	peakKB := <-memCh
	wallTimeMS := time.Since(start).Milliseconds()

	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("exec test case: %w", err)
	}

	result := &RunResult{
		Stdout:          stdoutBuf.Bytes(),
		Stderr:          stderrBuf.Bytes(),
		ExitCode:        exitCode,
		WallTimeMS:      wallTimeMS,
		MaxMemoryKB:     peakKB,
		TimedOut:        timedOut,
		// Exit code 137 (128+SIGKILL) is the same OOM heuristic the Docker
		// design used - the kernel's cgroup OOM killer sends SIGKILL to the
		// exec'd process. Kubernetes' pod-level "OOMKilled" status reflects
		// the container's PID 1 (a `sleep infinity` holder here, which never
		// touches memory), not an exec'd child, so that status is not usable
		// for this purpose - see the k3s migration design note.
		OOMKilled:       exitCode == 137,
		StdoutTruncated: stdoutBuf.truncated,
		StderrTruncated: stderrBuf.truncated,
	}
	span.SetAttributes(
		attribute.Int64("wall_time_ms", result.WallTimeMS),
		attribute.Bool("timed_out", result.TimedOut),
		attribute.Bool("oom_killed", result.OOMKilled),
	)
	return result, nil
}

// Close deletes the session's pod. Never returned to the pool or reused by
// another submission - see the design note on why isolation is scoped to the
// submission, not the test case.
func (sess *Session) Close() {
	if sess.podName == "" {
		return
	}
	delCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := sess.sandbox.deletePod(delCtx, sess.podName); err != nil {
		log.Warn().Err(err).Str("pod", sess.podName).Msg("failed to delete sandbox pod")
	}
}

// --------------------------------------------------------------------------
// cappedBuffer — io.Writer that truncates at a byte cap
// --------------------------------------------------------------------------

type cappedBuffer struct {
	buf       bytes.Buffer
	cap       int
	truncated bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	remaining := b.cap - b.buf.Len()
	if remaining <= 0 {
		b.truncated = true
		return len(p), nil
	}
	if len(p) > remaining {
		b.truncated = true
		p = p[:remaining]
	}
	return b.buf.Write(p)
}

func (b *cappedBuffer) Bytes() []byte {
	return b.buf.Bytes()
}

// --------------------------------------------------------------------------
// Verdict helpers — pure logic, no I/O
// --------------------------------------------------------------------------

// VerdictFromResult maps a raw RunResult to a domain Verdict.
func VerdictFromResult(r *RunResult, outputMatches bool) domain.Verdict {
	switch {
	case r.TimedOut:
		return domain.VerdictTLE
	case r.OOMKilled:
		return domain.VerdictMLE
	case r.CompileError:
		return domain.VerdictCE
	case r.ExitCode != 0:
		return domain.VerdictRE
	case !outputMatches:
		return domain.VerdictFailed
	default:
		return domain.VerdictPassed
	}
}

// OutputMatches does a normalised comparison between actual and expected output.
func OutputMatches(actual, expected []byte) bool {
	strip := func(b []byte) string {
		return strings.Join(strings.Fields(string(b)), "")
	}
	return strip(actual) == strip(expected)
}
