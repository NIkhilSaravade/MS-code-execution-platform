// sandboxcheck is a throwaway smoke-test binary for the Kubernetes sandbox
// package - NOT part of the production build. It exercises the pool
// checkout -> compile -> exec -> memory-sample -> close path directly
// against a real cluster, without needing Kafka/S3/the rest of the
// pipeline wired up. Delete once the k3s migration is validated, or keep it
// around as an ops smoke-test tool - either is fine.
//
// Usage (from inside the WSL2/k3s box, so the API server is reachable):
//
//	K8S_IN_CLUSTER=false KUBECONFIG_PATH=/etc/rancher/k3s/k3s.yaml \
//	  go run ./cmd/sandboxcheck
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/domain"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/sandbox"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fatalf("load config: %v", err)
	}
	fmt.Printf("namespace=%s in_cluster=%v runtime_class=%q pool_size=%d\n",
		cfg.K8sNamespace, cfg.K8sInCluster, cfg.SandboxRuntimeClassName, cfg.SandboxPoolSize)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sb, err := sandbox.New(ctx, cfg)
	if err != nil {
		fatalf("sandbox.New: %v", err)
	}
	defer sb.Close()

	ok := true
	ok = runCheck("compile+exec+stdin (Python)", pythonEchoUpperCheck(sb)) && ok
	ok = runCheck("network isolation (Python, expects blocked)", networkIsolationCheck(sb)) && ok
	ok = runCheck("compiled language + CE path (C++)", cppCompileErrorCheck(sb)) && ok

	if !ok {
		fmt.Println("\nFAIL: one or more checks did not pass")
		os.Exit(1)
	}
	fmt.Println("\nAll checks passed.")
}

func runCheck(name string, err error) bool {
	if err != nil {
		fmt.Printf("[FAIL] %-55s %v\n", name, err)
		return false
	}
	fmt.Printf("[ OK ] %-55s\n", name)
	return true
}

// pythonEchoUpperCheck validates the core path: checkout a pod, write
// source, exec it with stdin attached, read stdout back, tear down.
func pythonEchoUpperCheck(sb *sandbox.Sandbox) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	src := []byte("import sys\nprint(sys.stdin.read().strip().upper())\n")
	sess, err := sb.NewSession(ctx, &sandbox.SessionRequest{
		Language:    domain.LangPython,
		SourceCode:  src,
		WallTimeout: 10 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("new session: %w", err)
	}
	defer sess.Close()

	res, err := sess.RunTestCase(ctx, []byte("hello world"), 10*time.Second)
	if err != nil {
		return fmt.Errorf("run test case: %w", err)
	}
	fmt.Printf("        exit=%d wall_ms=%d peak_kb=%d stdout=%q stderr=%q\n",
		res.ExitCode, res.WallTimeMS, res.MaxMemoryKB, string(res.Stdout), string(res.Stderr))
	if res.ExitCode != 0 {
		return fmt.Errorf("nonzero exit %d, stderr=%s", res.ExitCode, res.Stderr)
	}
	if got := string(res.Stdout); got != "HELLO WORLD\n" {
		return fmt.Errorf("unexpected stdout %q", got)
	}
	return nil
}

// networkIsolationCheck verifies the default-deny NetworkPolicy is actually
// enforced (not just applied) - a real gap here is exactly the kind of
// thing that's silent until someone checks. Python's socket.connect should
// time out / refuse; we treat "connected" as a hard failure.
func networkIsolationCheck(sb *sandbox.Sandbox) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	src := []byte(`import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(3)
    s.connect(("8.8.8.8", 53))
    print("NETWORK_REACHABLE")
except Exception as e:
    print("NETWORK_BLOCKED:", e)
`)
	sess, err := sb.NewSession(ctx, &sandbox.SessionRequest{
		Language:    domain.LangPython,
		SourceCode:  src,
		WallTimeout: 10 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("new session: %w", err)
	}
	defer sess.Close()

	res, err := sess.RunTestCase(ctx, nil, 10*time.Second)
	if err != nil {
		return fmt.Errorf("run test case: %w", err)
	}
	fmt.Printf("        stdout=%q stderr=%q\n", string(res.Stdout), string(res.Stderr))
	if len(res.Stdout) >= len("NETWORK_REACHABLE") && string(res.Stdout[:17]) == "NETWORK_REACHABLE" {
		return fmt.Errorf("network was REACHABLE from inside the sandbox pod - NetworkPolicy is not enforced (check the CNI: Flannel does not enforce NetworkPolicy, this needs Calico)")
	}
	return nil
}

// cppCompileErrorCheck validates the once-per-submission compile step and
// the CompileError short-circuit path executor.go depends on.
func cppCompileErrorCheck(sb *sandbox.Sandbox) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	src := []byte("int main() { this is not valid c++ }")
	sess, err := sb.NewSession(ctx, &sandbox.SessionRequest{
		Language:    domain.LangCPP,
		SourceCode:  src,
		WallTimeout: 10 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("new session: %w", err)
	}
	defer sess.Close()

	if !sess.CompileError {
		return fmt.Errorf("expected CompileError=true for invalid C++, got false")
	}
	fmt.Printf("        compile_output=%q\n", string(sess.CompileOutput))
	if len(sess.CompileOutput) == 0 {
		return fmt.Errorf("expected non-empty compiler stderr")
	}
	return nil
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
