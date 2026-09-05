package sandbox

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
	k8sexec "k8s.io/client-go/util/exec"
)

// execInPod runs command inside the named pod/container via the Kubernetes
// exec subresource - the direct equivalent of `kubectl exec`, and (via
// StreamWithContext) of `docker run -i`'s stdin attach: ctx cancellation
// tears down the exec stream, which is how the host-enforced wall-clock
// timeout is applied (a compromised process inside the pod cannot disable
// this, same guarantee the old Docker design documented).
//
// Returns the command's exit code and whether ctx's deadline was what ended
// the stream. A non-nil error means an infrastructure failure (couldn't even
// start the exec), not a nonzero exit from the user's code.
func execInPod(
	ctx context.Context,
	restCfg *rest.Config,
	clientset *kubernetes.Clientset,
	namespace, podName, container string,
	command []string,
	stdin io.Reader,
	stdout, stderr io.Writer,
) (exitCode int, timedOut bool, err error) {
	req := clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(podName).
		Namespace(namespace).
		SubResource("exec")
	req.VersionedParams(&corev1.PodExecOptions{
		Container: container,
		Command:   command,
		Stdin:     stdin != nil,
		Stdout:    true,
		Stderr:    true,
		TTY:       false,
	}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(restCfg, "POST", req.URL())
	if err != nil {
		return 0, false, fmt.Errorf("build exec request: %w", err)
	}

	streamErr := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:  stdin,
		Stdout: stdout,
		Stderr: stderr,
		Tty:    false,
	})
	if streamErr == nil {
		return 0, false, nil
	}

	var codeErr k8sexec.CodeExitError
	if errors.As(streamErr, &codeErr) {
		return codeErr.Code, false, nil
	}
	if ctx.Err() == context.DeadlineExceeded {
		return -1, true, nil
	}
	return 0, false, fmt.Errorf("exec stream: %w", streamErr)
}

// writeFileToPod delivers source code into the pod's scratch volume. There's
// no direct "copy a file in" primitive over the exec subresource (this is
// exactly what `kubectl cp` fakes internally) - so this pipes the content as
// stdin to a `cat > <path>` command running inside the pod, the same
// mechanism `kubectl cp` relies on, just without the tar layer since we're
// always writing exactly one file to a known path.
func writeFileToPod(ctx context.Context, restCfg *rest.Config, clientset *kubernetes.Clientset, namespace, podName, container, path string, content []byte) error {
	cmd := []string{"sh", "-c", "cat > " + shQuote(path)}
	var stderrBuf bytes.Buffer
	exitCode, timedOut, err := execInPod(ctx, restCfg, clientset, namespace, podName, container, cmd, bytes.NewReader(content), io.Discard, &stderrBuf)
	if err != nil {
		return err
	}
	if timedOut {
		return fmt.Errorf("timed out writing file into sandbox pod")
	}
	if exitCode != 0 {
		return fmt.Errorf("write file exited %d: %s", exitCode, stderrBuf.String())
	}
	return nil
}

func shQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// sampleContainerPeakMemoryKB replaces `docker stats`: there's no per-Pod
// equivalent, and the kubelet stats API only updates on a ~10s cadence, far
// too coarse for a run that may finish in under a second. Instead this execs
// a tight polling loop inside the SAME container that reads cgroup v2's
// memory.current directly, streaming one line per sample back over the exec
// stdout - one exec session for the whole test case's duration (not one
// exec per sample), mirroring the old design's fix for `docker stats`
// per-invocation startup cost. Stops when ctx is cancelled (the test case's
// own exec has finished). Best-effort: any failure just reports peak 0,
// same as before.
func sampleContainerPeakMemoryKB(ctx context.Context, restCfg *rest.Config, clientset *kubernetes.Clientset, namespace, podName string, period time.Duration, resultCh chan<- int64) {
	if period <= 0 {
		period = 20 * time.Millisecond
	}
	sleepArg := strconv.FormatFloat(period.Seconds(), 'f', 3, 64)
	cmd := []string{"sh", "-c", "while true; do cat /sys/fs/cgroup/memory.current 2>/dev/null; echo; sleep " + sleepArg + "; done"}

	pr, pw := io.Pipe()
	go func() {
		req := clientset.CoreV1().RESTClient().Post().
			Resource("pods").Name(podName).Namespace(namespace).SubResource("exec")
		req.VersionedParams(&corev1.PodExecOptions{
			Container: sandboxContainerName,
			Command:   cmd,
			Stdout:    true,
			Stderr:    false,
			TTY:       false,
		}, scheme.ParameterCodec)

		executor, err := remotecommand.NewSPDYExecutor(restCfg, "POST", req.URL())
		if err != nil {
			_ = pw.CloseWithError(err)
			return
		}
		// Errors here are expected once ctx is cancelled (stream torn down
		// mid-loop) - best-effort sampling, not worth surfacing.
		_ = executor.StreamWithContext(ctx, remotecommand.StreamOptions{Stdout: pw, Tty: false})
		_ = pw.Close()
	}()

	var peakKB int64
	scanner := bufio.NewScanner(pr)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		bytesUsed, err := strconv.ParseInt(line, 10, 64)
		if err != nil {
			continue
		}
		if kb := bytesUsed / 1024; kb > peakKB {
			peakKB = kb
		}
	}
	resultCh <- peakKB
}
