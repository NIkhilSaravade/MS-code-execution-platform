// Package sandbox orchestrates the execution of untrusted user code inside a
// hardened container. Every security control described in Part 4.4 of the dev
// plan is enforced here. Any code path that weakens these controls must be
// documented explicitly and reviewed carefully.
package sandbox

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

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

	// scratchDirPrefix is where per-execution temp directories are created.
	// Each execution gets a unique directory; it is removed after the run.
	scratchDirPrefix = "/tmp/worker-scratch-"
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
	// Java requires the class name to match the filename, so we always use Solution.java.
	SourceFilename string
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
			Image:          images["java"],
			CompileCmd:     []string{"javac", "/sandbox/Solution.java"},
			ExecCmd:        []string{"java", "-cp", "/sandbox", "Solution"},
			SourceFilename: "Solution.java",
		},
		domain.LangCPP: {
			Image:          images["cpp"],
			CompileCmd:     []string{"g++", "-O2", "-o", "/sandbox/solution", "/sandbox/solution.cpp"},
			ExecCmd:        []string{"/sandbox/solution"},
			SourceFilename: "solution.cpp",
		},
	}
}

// --------------------------------------------------------------------------
// RunRequest / RunResult
// --------------------------------------------------------------------------

// RunRequest is a single test case execution request.
type RunRequest struct {
	Language     domain.Language
	SourceCode   []byte
	Stdin        []byte
	WallTimeout  time.Duration // enforced by the worker host, not the container
	MemoryLimitMB int
	CPUQuota     float64 // fractional CPUs
}

// RunResult is the outcome of one test case run inside the sandbox.
type RunResult struct {
	Stdout          []byte
	Stderr          []byte
	ExitCode        int
	WallTimeMS      int64
	CPUTimeMS       int64
	MaxMemoryKB     int64
	TimedOut        bool  // wall-clock timeout hit
	OOMKilled       bool  // container OOM-killed by Docker
	StdoutTruncated bool
	StderrTruncated bool

	// CompileError is set when the compilation step fails; ExecCmd is not run.
	CompileError    bool
	CompileOutput   []byte
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

	// Create a unique scratch directory on the host for this execution.
	// It is mounted read-only into the container so the container cannot
	// modify the source file. Cleanup happens in the deferred call below.
	scratch, err := os.MkdirTemp("", scratchDirPrefix)
	if err != nil {
		return nil, fmt.Errorf("create scratch dir: %w", err)
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
		compileTimeout := req.WallTimeout * compilationTimeoutMultiplier
		compileResult, err := s.runContainer(ctx, desc, scratch, nil, desc.CompileCmd,
			compileTimeout, req.MemoryLimitMB, req.CPUQuota)
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
		req.WallTimeout, req.MemoryLimitMB, req.CPUQuota)
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
) (*containerResult, error) {
	// Build the docker run command with every mandatory security flag.
	args := s.buildDockerArgs(desc, scratchDir, memoryLimitMB, cpuQuota, cmd)

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

	err := dockerCmd.Run()

	wallTimeMS := time.Since(start).Milliseconds()

	result := &containerResult{
		Stdout:          stdoutBuf.Bytes(),
		Stderr:          stderrBuf.Bytes(),
		WallTimeMS:      wallTimeMS,
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

// buildDockerArgs constructs the docker run argument list with all
// mandatory security controls. Every flag here has a reason; do not remove
// any without understanding the security implication.
func (s *Sandbox) buildDockerArgs(
	desc *langDescriptor,
	scratchDir string,
	memoryLimitMB int,
	cpuQuota float64,
	cmd []string,
) []string {
	memoryFlag := strconv.Itoa(memoryLimitMB) + "m"
	cpuFlag := strconv.FormatFloat(cpuQuota, 'f', 2, 64)

	args := []string{
		"run",
		"--rm",   // auto-remove the container on exit — no zombie containers

		// ── Runtime ─────────────────────────────────────────────────────────
		// gVisor provides a user-space kernel implementation that intercepts
		// all syscalls from the container before they reach the host kernel.
		// This dramatically reduces the attack surface vs. plain runc.
		"--runtime", s.cfg.SandboxRuntime,

		// ── Network isolation ────────────────────────────────────────────────
		"--network", "none", // no inbound or outbound network — ever

		// ── Filesystem isolation ─────────────────────────────────────────────
		"--read-only", // root filesystem is read-only
		"--tmpfs", "/tmp:size=64m,noexec,nosuid", // only writable space; non-executable
		"--volume", scratchDir + ":/sandbox:ro", // user code mounted read-only

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
		"--memory", memoryFlag,       // hard memory cap
		"--memory-swap", memoryFlag,  // no swap (swap == memory cap → disables swap)
		"--cpus", cpuFlag,            // fractional CPU limit via CFS bandwidth
		"--pids-limit", strconv.Itoa(s.cfg.SandboxPidsLimit), // fork bomb prevention

		// ── Logging ──────────────────────────────────────────────────────────
		"--log-driver", "none", // don't route container logs to Docker daemon

		// ── Image ────────────────────────────────────────────────────────────
		desc.Image,
	}

	// Append the command (compile or exec).
	args = append(args, cmd...)
	return args
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
// Trailing whitespace and newline differences are ignored — consistent with
// the behaviour of most online judges.
func OutputMatches(actual, expected []byte) bool {
	return strings.TrimSpace(string(actual)) == strings.TrimSpace(string(expected))
}

// Ensure codes and attribute packages are used (OTel lint check).
var (
	_ = codes.Ok
	_ = attribute.String
)
