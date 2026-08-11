// Package sandbox orchestrates the execution of untrusted user code inside a
// hardened container. Every security control described in Part 4.4 of the dev
// plan is enforced here. Any code path that weakens these controls must be
// documented explicitly and reviewed carefully.
package sandbox

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/domain"
)

const (
	// maxOutputBytes is the hard cap on combined stdout+stderr returned to the
	// worker. Submissions that produce more are truncated and flagged.
	// Protects against output-flood attacks.
	maxOutputBytesDefault = 512 * 1024 // 512 KB

	// compilationTimeoutMultiplier gives compilation a proportionally longer
	// wall-clock timeout than execution (compilation can be slow for Java/C++).
	compilationTimeoutMultiplier = 3

	// minCompileTimeout is a floor under compilationTimeoutMultiplier*wallTimeout.
	// A problem's timeLimitMs sizes the EXECUTION budget (how long the
	// algorithm itself should take) - JVM/javac startup overhead is roughly
	// constant regardless of that, so a fast problem (e.g. timeLimitMs=2000)
	// could otherwise give compilation as little as 6s, nowhere near enough
	// for a cold JVM to even start up.
	minCompileTimeout = 15 * time.Second

	// scratchDirPrefix names per-execution temp directories, created under
	// cfg.ScratchContainerDir (see config.Config's Docker-outside-of-Docker
	// comment). Each execution gets a unique directory, removed after the run.
	scratchDirPrefix = "worker-scratch-"
)

// --------------------------------------------------------------------------
// Language descriptors
// --------------------------------------------------------------------------

// langDescriptor holds the Docker image and the commands needed to compile
// (optional) and run code in a given language, inside the sandbox container.
type langDescriptor struct {
	// Image is the Docker image tag to use for this language.
	Image string

	// CompileCmd, when non-nil, is run before ExecCmd.
	// $SOURCE is substituted with the path to the source file inside the container.
	CompileCmd []string

	// ExecCmd runs the compiled binary (or interpreter) with test input on stdin.
	// $BINARY is substituted with the compiled output path (for compiled languages).
	// $SOURCE is substituted with the source path (for interpreted languages).
	ExecCmd []string

	// SourceFilename is the name given to the user's code file inside the container.
	// Java requires the class name to match the filename, so we always use Main.java.
	SourceFilename string

	// Env holds extra "KEY=VALUE" environment variables passed to every
	// container run for this language. Every other language needs none of
	// this (nil); Go needs GOCACHE/HOME pointed at a writable path - by
	// default the go tool wants to write its build cache under $HOME, which
	// doesn't exist as a writable location for the sandbox's non-root user
	// on a read-only rootfs.
	Env []string
}

func buildLangDescriptors(images map[string]string) map[domain.Language]*langDescriptor {
	return map[domain.Language]*langDescriptor{
		domain.LangPython: {
			Image:          images["python"],
			CompileCmd:     nil, // interpreted — no compilation step
			ExecCmd:        []string{"python3", "/sandbox/solution.py"},
			SourceFilename: "solution.py",
		},
		domain.LangJava: {
			Image: images["java"],
			// javac writes .class files alongside the source by default -
			// fine here because the compile step's /sandbox mount is
			// writable (see buildDockerArgs' writableSource); the SEPARATE
			// exec-step container that runs afterward sees those same
			// compiled files through its own (read-only) mount of the same
			// underlying scratch subpath.
			CompileCmd: []string{"javac", "/sandbox/Main.java"},
			ExecCmd:    []string{"java", "-cp", "/sandbox", "Main"},
			// Main, not Solution: the user's own class is already named
			// Solution (matching the LeetCode-style stub - see
			// problem-service's harness package), so the harness-generated
			// entry point with main() must be named something else. Matches
			// worker-service's (the legacy Java worker's) same convention,
			// which the harness generator was written against.
			SourceFilename: "Main.java",
		},
		domain.LangCPP: {
			Image: images["cpp"],
			// -std=c++17 pinned explicitly (rather than trusting gcc's
			// implicit default, which varies by version) - the frontend's
			// C++ language option is labeled "C++17", so this is what
			// actually has to compile against.
			CompileCmd:     []string{"g++", "-std=c++17", "-O2", "-o", "/sandbox/solution", "/sandbox/solution.cpp"},
			ExecCmd:        []string{"/sandbox/solution"},
			SourceFilename: "solution.cpp",
		},
		domain.LangC: {
			Image: images["c"],
			// -std=c11 pinned to match the frontend's "C11" label - see the
			// -std=c++17 comment above.
			CompileCmd:     []string{"gcc", "-std=c11", "-O2", "-o", "/sandbox/solution", "/sandbox/solution.c", "-lm"},
			ExecCmd:        []string{"/sandbox/solution"},
			SourceFilename: "solution.c",
		},
		domain.LangJavaScript: {
			Image:          images["javascript"],
			CompileCmd:     nil, // interpreted — no compilation step
			ExecCmd:        []string{"node", "/sandbox/solution.js"},
			SourceFilename: "solution.js",
		},
		domain.LangTypeScript: {
			// images["typescript"] must be a locally-built image with tsc
			// preinstalled - see infra/sandbox-images/node-typescript. No
			// official Node image ships the TypeScript compiler, and the
			// compile step can't `npm install` it at request time since the
			// sandbox always runs with --network none.
			Image:          images["typescript"],
			CompileCmd:     []string{"tsc", "--target", "es2016", "--module", "commonjs", "/sandbox/solution.ts"},
			ExecCmd:        []string{"node", "/sandbox/solution.js"},
			SourceFilename: "solution.ts",
		},
		domain.LangGo: {
			Image:          images["go"],
			CompileCmd:     []string{"go", "build", "-o", "/sandbox/solution", "/sandbox/solution.go"},
			ExecCmd:        []string{"/sandbox/solution"},
			SourceFilename: "solution.go",
			// GOMAXPROCS=1 / GOFLAGS=-p=1 force the go tool to compile one
			// package at a time. Without this, a cold GOCACHE (fresh every
			// submission - see below) makes `go build` compile the user's
			// file's entire stdlib dependency chain (encoding/json, fmt,
			// reflect, unicode, sync, ...) with many packages' compile/asm
			// subprocesses running concurrently, which blew straight through
			// --pids-limit (fork-bomb protection, default 64) and failed
			// every submission with "resource temporarily unavailable" -
			// caught via direct reproduction outside the full pipeline.
			Env: []string{"GOCACHE=/tmp/gocache", "HOME=/tmp", "GOMAXPROCS=1", "GOFLAGS=-p=1"},
		},
	}
}

// --------------------------------------------------------------------------
// RunRequest / RunResult
// --------------------------------------------------------------------------

// RunRequest is a single test case execution request.
type RunRequest struct {
	Language      domain.Language
	SourceCode    []byte
	Stdin         []byte
	WallTimeout   time.Duration // enforced by the worker host, not the container
	MemoryLimitMB int
	CPUQuota      float64 // fractional CPUs
}

// RunResult is the outcome of one test case run inside the sandbox.
type RunResult struct {
	Stdout          []byte
	Stderr          []byte
	ExitCode        int
	WallTimeMS      int64
	CPUTimeMS       int64
	MaxMemoryKB     int64
	TimedOut        bool // wall-clock timeout hit
	OOMKilled       bool // container OOM-killed by Docker
	StdoutTruncated bool
	StderrTruncated bool

	// CompileError is set when the compilation step fails; ExecCmd is not run.
	CompileError  bool
	CompileOutput []byte
}

// --------------------------------------------------------------------------
// Sandbox
// --------------------------------------------------------------------------

// Sandbox executes untrusted code in a hardened Docker container.
// It is safe for concurrent use — each Run call creates a completely independent
// container and scratch directory.
type Sandbox struct {
	cfg   *config.Config
	langs map[domain.Language]*langDescriptor

	// outputCapBytes is the per-run hard limit on combined stdout+stderr.
	outputCapBytes int
}

// New creates a Sandbox. Call once at startup and reuse across submissions.
func New(cfg *config.Config) *Sandbox {
	cap := cfg.SandboxOutputCapKB * 1024
	if cap <= 0 {
		cap = maxOutputBytesDefault
	}
	return &Sandbox{
		cfg:            cfg,
		langs:          buildLangDescriptors(cfg.LanguageImages),
		outputCapBytes: cap,
	}
}

// Run executes one test case and returns the raw sandbox output.
// The caller (executor) is responsible for verdict computation by comparing
// RunResult.Stdout to the expected output.
//
// Security guarantee: every call to Run spawns a fresh container with
// --network none, --read-only rootfs, non-root user, all caps dropped,
// and a wall-clock timeout enforced by this function — not the container.
// A compromised container cannot disable the host-side timeout.
func (s *Sandbox) Run(ctx context.Context, req *RunRequest) (*RunResult, error) {
	ctx, span := otel.Tracer("worker-service/sandbox.Sandbox").Start(ctx, "sandbox.Run")
	defer span.End()
	span.SetAttributes(
		attribute.String("language", string(req.Language)),
		attribute.Int("stdin_bytes", len(req.Stdin)),
		attribute.Int64("wall_timeout_ms", req.WallTimeout.Milliseconds()),
	)

	desc, ok := s.langs[req.Language]
	if !ok {
		return nil, fmt.Errorf("unsupported language: %s", req.Language)
	}

	// Create a unique scratch directory for this execution, inside the named
	// volume shared with sibling execution containers (see config.Config's
	// ScratchContainerDir/ScratchVolumeName comment - this is NOT a host
	// path, it's this container's own mount point of that shared volume).
	// Cleanup happens in the deferred call below.
	scratch, err := os.MkdirTemp(s.cfg.ScratchContainerDir, scratchDirPrefix)
	if err != nil {
		return nil, fmt.Errorf("create scratch dir: %w", err)
	}
	// os.MkdirTemp creates directories 0700 (owner-only). The sandbox
	// container runs as nobody:65534 (see --user in buildDockerArgs), a
	// different UID than this process, so without relaxing the directory's
	// own permissions it couldn't even traverse into it to read the source
	// file - regardless of the file's own 0444 mode below. 0777 (not 0755):
	// the compile step (see writableSource in buildDockerArgs) also needs to
	// WRITE compiled output here as that same non-owner UID, and this
	// directory only ever exists for one submission's lifetime before being
	// removed - not a broader exposure.
	if err := os.Chmod(scratch, 0o777); err != nil {
		return nil, fmt.Errorf("relax scratch dir permissions: %w", err)
	}
	defer func() {
		if rmErr := os.RemoveAll(scratch); rmErr != nil {
			log.Warn().Err(rmErr).Str("dir", scratch).Msg("failed to remove scratch dir")
		}
	}()

	// Write source code to the scratch directory under the required filename.
	srcPath := filepath.Join(scratch, desc.SourceFilename)
	if err := os.WriteFile(srcPath, req.SourceCode, 0o444); err != nil {
		return nil, fmt.Errorf("write source to scratch: %w", err)
	}

	result := &RunResult{}

	// ---------- compilation step (compiled languages only) ----------
	if desc.CompileCmd != nil {
		compileTimeout := max(req.WallTimeout*compilationTimeoutMultiplier, minCompileTimeout)
		compileResult, err := s.runContainer(ctx, desc, scratch, nil, desc.CompileCmd,
			compileTimeout, req.MemoryLimitMB, req.CPUQuota, true)
		if err != nil {
			return nil, fmt.Errorf("run compilation container: %w", err)
		}
		if compileResult.ExitCode != 0 {
			result.CompileError = true
			result.CompileOutput = compileResult.Stderr
			result.ExitCode = compileResult.ExitCode
			span.SetAttributes(attribute.Bool("compile_error", true))
			return result, nil
		}
	}

	// ---------- execution step ----------
	execResult, err := s.runContainer(ctx, desc, scratch, req.Stdin, desc.ExecCmd,
		req.WallTimeout, req.MemoryLimitMB, req.CPUQuota, false)
	if err != nil {
		return nil, fmt.Errorf("run execution container: %w", err)
	}

	result.Stdout = execResult.Stdout
	result.Stderr = execResult.Stderr
	result.ExitCode = execResult.ExitCode
	result.WallTimeMS = execResult.WallTimeMS
	result.CPUTimeMS = execResult.CPUTimeMS
	result.MaxMemoryKB = execResult.MaxMemoryKB
	result.TimedOut = execResult.TimedOut
	result.OOMKilled = execResult.OOMKilled
	result.StdoutTruncated = execResult.StdoutTruncated
	result.StderrTruncated = execResult.StderrTruncated

	span.SetAttributes(
		attribute.Int64("wall_time_ms", result.WallTimeMS),
		attribute.Bool("timed_out", result.TimedOut),
		attribute.Bool("oom_killed", result.OOMKilled),
	)
	return result, nil
}

// --------------------------------------------------------------------------
// container orchestration
// --------------------------------------------------------------------------

type containerResult struct {
	Stdout          []byte
	Stderr          []byte
	ExitCode        int
	WallTimeMS      int64
	CPUTimeMS       int64
	MaxMemoryKB     int64
	TimedOut        bool
	OOMKilled       bool
	StdoutTruncated bool
	StderrTruncated bool
}

func (s *Sandbox) runContainer(
	ctx context.Context,
	desc *langDescriptor,
	scratchDir string,
	stdin []byte,
	cmd []string,
	wallTimeout time.Duration,
	memoryLimitMB int,
	cpuQuota float64,
	writableSource bool,
) (*containerResult, error) {
	// A named container (instead of an anonymous one) so peakMemorySampler
	// can poll `docker stats` for it by name while it's still running -
	// --rm removes it immediately on exit, which would otherwise race any
	// stats query issued afterward.
	containerName := "exec-" + uuid.New().String()
	args := s.buildDockerArgs(desc, scratchDir, memoryLimitMB, cpuQuota, cmd, writableSource, containerName)

	// The wall-clock timeout is enforced by the host via context cancellation.
	// We do NOT rely on the container to time itself out — a compromised or
	// misbehaving container cannot be trusted to honour its own timeout.
	timeoutCtx, cancel := context.WithTimeout(ctx, wallTimeout)
	defer cancel()

	dockerCmd := exec.CommandContext(timeoutCtx, "docker", args...)

	// Pipe stdin to the container.
	if len(stdin) > 0 {
		dockerCmd.Stdin = bytes.NewReader(stdin)
	}

	var stdoutBuf, stderrBuf cappedBuffer
	stdoutBuf.cap = s.outputCapBytes / 2
	stderrBuf.cap = s.outputCapBytes / 2
	dockerCmd.Stdout = &stdoutBuf
	dockerCmd.Stderr = &stderrBuf

	start := time.Now()

	// Best-effort peak-memory sampling: poll `docker stats` for this
	// container by name while it runs. If sampling fails entirely (e.g. the
	// container exits before the first sample, or `docker stats` itself
	// errors), peakMemoryKB just stays 0 - callers treat that as "no data"
	// rather than a hard failure.
	samplerCtx, stopSampler := context.WithCancel(ctx)
	memSampleCh := make(chan int64, 1)
	go samplePeakMemoryKB(samplerCtx, containerName, memSampleCh)

	err := dockerCmd.Run()
	stopSampler()
	peakMemoryKB := <-memSampleCh

	wallTimeMS := time.Since(start).Milliseconds()

	result := &containerResult{
		Stdout:          stdoutBuf.Bytes(),
		Stderr:          stderrBuf.Bytes(),
		WallTimeMS:      wallTimeMS,
		MaxMemoryKB:     peakMemoryKB,
		StdoutTruncated: stdoutBuf.truncated,
		StderrTruncated: stderrBuf.truncated,
	}

	if timeoutCtx.Err() == context.DeadlineExceeded {
		result.TimedOut = true
		result.ExitCode = -1
		// Kill the container — it may still be running since context expiry
		// sends SIGKILL to the docker CLI but the container daemon handles it
		// asynchronously. Force-remove to be safe.
		s.forceRemoveContainer(ctx, dockerCmd)
		return result, nil
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
			// Docker exits with status 137 when the container is OOM-killed.
			if result.ExitCode == 137 {
				result.OOMKilled = true
			}
			// Non-zero exit is normal for CE and RE — not a platform error.
			return result, nil
		}
		return nil, fmt.Errorf("docker exec error: %w", err)
	}

	result.ExitCode = 0
	return result, nil
}

// readonlySuffix returns ",readonly" unless the caller needs to write into
// the mount (see buildDockerArgs' writableSource parameter).
func readonlySuffix(writable bool) string {
	if writable {
		return ""
	}
	return ",readonly"
}

// buildDockerArgs constructs the docker run argument list with all
// mandatory security controls. Every flag here has a reason; do not remove
// any without understanding the security implication.
func (s *Sandbox) buildDockerArgs(
	desc *langDescriptor,
	scratchDir string,
	memoryLimitMB int,
	cpuQuota float64,
	cmd []string,
	writableSource bool,
	containerName string,
) []string {
	memoryFlag := strconv.Itoa(memoryLimitMB) + "m"
	cpuFlag := strconv.FormatFloat(cpuQuota, 'f', 2, 64)

	args := []string{
		"run",
		"--rm",                  // auto-remove the container on exit — no zombie containers
		"--name", containerName, // lets peakMemorySampler poll `docker stats` by name
		"-i", // attach stdin — without this, `docker run` never connects
		// the container's stdin at all, so a program that actually
		// reads from it (e.g. the harness's sys.stdin.read() - see
		// problem-service's harness package) gets nothing instead
		// of the test case input. Never caught before since nothing
		// previously submitted actually read stdin.

		// ── Runtime ─────────────────────────────────────────────────────────
		// gVisor provides a user-space kernel implementation that intercepts
		// all syscalls from the container before they reach the host kernel.
		// This dramatically reduces the attack surface vs. plain runc.
		"--runtime", s.cfg.SandboxRuntime,

		// ── Network isolation ────────────────────────────────────────────────
		"--network", "none", // no inbound or outbound network — ever

		// ── Filesystem isolation ─────────────────────────────────────────────
		"--read-only",                            // root filesystem is read-only
		"--tmpfs", "/tmp:size=64m,noexec,nosuid", // only writable space; non-executable

		// User code, normally mounted read-only. This worker only ever talks
		// to the HOST Docker daemon (via the mounted docker.sock) to launch
		// this sibling container - a plain --volume bind-mount using this
		// container's own filesystem path (scratchDir) would resolve against
		// the HOST's filesystem and mount nothing/empty, since that path only
		// exists inside this container. Mounting a SUB-PATH of the shared
		// named volume instead works because the host daemon resolves the
		// volume by name, not by this container's view of the filesystem.
		//
		// writableSource is true only for the COMPILE step of compiled
		// languages: compile and exec are two SEPARATE `docker run`
		// invocations, each getting its own fresh, unshared --tmpfs /tmp - a
		// compiler can't write its output to /tmp and expect the later exec
		// container to see it. The compiled .class/.o files have to land
		// back in the shared scratch subpath instead, which is why that one
		// step needs write access; the exec step (running the untrusted
		// compiled/interpreted code itself) stays read-only as before.
		"--mount", fmt.Sprintf(
			"type=volume,source=%s,target=/sandbox%s,volume-subpath=%s",
			s.cfg.ScratchVolumeName, readonlySuffix(writableSource), filepath.Base(scratchDir),
		),

		// ── Identity ─────────────────────────────────────────────────────────
		// Run as a non-root user inside the container. UID 65534 is "nobody"
		// on most Linux distributions.
		"--user", "65534:65534",

		// ── Linux capabilities ───────────────────────────────────────────────
		// Drop ALL capabilities. Language runtimes don't need any.
		"--cap-drop", "ALL",

		// ── Privilege escalation prevention ──────────────────────────────────
		"--security-opt", "no-new-privileges",

		// ── Seccomp profile ──────────────────────────────────────────────────
		// A restrictive seccomp profile that allows only the syscalls needed
		// by Python, Java, and C++ runtimes. See /etc/docker/seccomp/execution.json.
		// Falls back to Docker's default seccomp profile if the file doesn't exist.
		"--security-opt", "seccomp=/etc/docker/seccomp/execution.json",

		// ── Resource limits ──────────────────────────────────────────────────
		"--memory", memoryFlag, // hard memory cap
		"--memory-swap", memoryFlag, // no swap (swap == memory cap → disables swap)
		"--cpus", cpuFlag, // fractional CPU limit via CFS bandwidth
		"--pids-limit", strconv.Itoa(s.cfg.SandboxPidsLimit), // fork bomb prevention

		// ── Logging ──────────────────────────────────────────────────────────
		"--log-driver", "none", // don't route container logs to Docker daemon
	}

	// ── Language-specific environment ─────────────────────────────────────
	// Only Go currently needs this (GOCACHE/HOME) - see langDescriptor.Env.
	for _, kv := range desc.Env {
		args = append(args, "-e", kv)
	}

	// ── Image ────────────────────────────────────────────────────────────
	args = append(args, desc.Image)

	// Append the command (compile or exec).
	args = append(args, cmd...)
	return args
}

// samplePeakMemoryKB streams `docker stats` for containerName until ctx is
// cancelled (the container has exited), tracking the highest memory usage
// seen, then sends the result on resultCh.
//
// This spawns exactly ONE `docker stats` process for the container's whole
// lifetime rather than re-invoking the CLI on a poll interval - an earlier
// version did that (`docker stats --no-stream`, one process per sample,
// every 25ms), but a single such invocation was measured taking ~1.5s
// end-to-end inside this container (CLI startup + API round trip), far
// longer than most sandboxed executions run - the sampler never landed a
// single sample before the container had already exited and been removed.
// Streaming mode pays that startup cost once and then reads continuous
// updates over the same connection.
//
// Still best-effort: a container whose entire lifetime is shorter than
// docker stats' first update tick reports 0, same as before.
func samplePeakMemoryKB(ctx context.Context, containerName string, resultCh chan<- int64) {
	cmd := exec.CommandContext(ctx, "docker", "stats", containerName, "--format", "{{.MemUsage}}")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		resultCh <- 0
		return
	}
	if err := cmd.Start(); err != nil {
		resultCh <- 0
		return
	}

	var peakKB int64
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		// Streaming mode prefixes each update with an ANSI cursor-repositioning
		// escape sequence (even though stdout isn't a TTY here) - strip it
		// before parsing the actual "used / limit" text.
		line := ansiEscapePattern.ReplaceAllString(scanner.Text(), "")
		if kb := parseMemUsageKB(strings.TrimSpace(line)); kb > peakKB {
			peakKB = kb
		}
	}
	if err := scanner.Err(); err != nil {
		// Expected once ctx is cancelled and the process is killed - not
		// worth logging (see the function doc: best-effort sample).
		_ = err
	}

	// ctx cancellation (via CommandContext) kills the process; Wait() reaps
	// it. Errors here are expected (killed process) and not worth reporting -
	// this is a best-effort sample, not a correctness-critical measurement.
	_ = cmd.Wait()
	resultCh <- peakKB
}

var ansiEscapePattern = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)

// parseMemUsageKB parses `docker stats`' MemUsage format, e.g.
// "12.5MiB / 256MiB" -> the used-memory side, converted to KB. Returns 0 on
// any format it doesn't recognize rather than erroring - this is a
// best-effort sample, not a correctness-critical measurement.
func parseMemUsageKB(memUsage string) int64 {
	used, _, found := strings.Cut(memUsage, " / ")
	if !found {
		return 0
	}
	used = strings.TrimSpace(used)

	var unit string
	var numEnd int
	for numEnd = 0; numEnd < len(used); numEnd++ {
		c := used[numEnd]
		if !(c >= '0' && c <= '9' || c == '.') {
			break
		}
	}
	if numEnd == 0 {
		return 0
	}
	value, err := strconv.ParseFloat(used[:numEnd], 64)
	if err != nil {
		return 0
	}
	unit = strings.ToUpper(strings.TrimSpace(used[numEnd:]))

	switch unit {
	case "B":
		return int64(value / 1024)
	case "KIB", "KB":
		return int64(value)
	case "MIB", "MB":
		return int64(value * 1024)
	case "GIB", "GB":
		return int64(value * 1024 * 1024)
	default:
		return 0
	}
}

// forceRemoveContainer attempts to force-kill a container that may still be
// running after the wall-clock timeout fired. Best-effort — log errors but
// don't propagate them.
func (s *Sandbox) forceRemoveContainer(ctx context.Context, cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	if err := cmd.Process.Signal(syscall.SIGKILL); err != nil {
		log.Warn().Err(err).Msg("could not SIGKILL timed-out container process")
	}
}

// --------------------------------------------------------------------------
// cappedBuffer — io.Writer that truncates at a byte cap
// --------------------------------------------------------------------------

// cappedBuffer is a bytes.Buffer that stops writing after cap bytes have been
// accumulated. It is used to enforce the output size limit on stdout and stderr.
type cappedBuffer struct {
	buf       bytes.Buffer
	cap       int
	truncated bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	remaining := b.cap - b.buf.Len()
	if remaining <= 0 {
		b.truncated = true
		return len(p), nil // silently discard — caller reads truncated flag
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
// Called by the executor after comparing stdout to expected output.
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
// ALL whitespace is stripped, not just leading/trailing (matches
// worker-service's equivalent normalization) - harness-generated output is
// compact JSON with no whitespace at all, so this only matters for
// non-harness (raw script) problems, but stripping internal whitespace too
// means e.g. "[0, 1]" and "[0,1]" are correctly treated as equivalent instead
// of a spurious mismatch.
func OutputMatches(actual, expected []byte) bool {
	strip := func(b []byte) string {
		return strings.Join(strings.Fields(string(b)), "")
	}
	return strip(actual) == strip(expected)
}

// Ensure codes and attribute packages are used (OTel lint check).
var (
	_ = codes.Ok
	_ = attribute.String
)
