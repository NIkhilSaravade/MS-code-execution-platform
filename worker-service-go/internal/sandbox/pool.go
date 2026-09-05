package sandbox

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/wait"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/domain"
)

// pool holds pre-warmed, idle sandbox Pods for one language. Pods are
// checked out for the life of exactly one submission and never returned -
// see the design note on why isolation is scoped per-submission, not
// per-checkout. A background goroutine keeps the pool topped up so the
// *next* submission's checkout is fast, not this one's.
type pool struct {
	sandbox *Sandbox
	lang    domain.Language
	desc    *langDescriptor
	ch      chan string
	size    int
}

// getOrCreatePool returns the pool for lang, creating it (and starting its
// replenishment goroutine) on first use.
func (s *Sandbox) getOrCreatePool(lang domain.Language, desc *langDescriptor) *pool {
	s.poolMu.Lock()
	defer s.poolMu.Unlock()
	if p, ok := s.pools[lang]; ok {
		return p
	}
	p := &pool{
		sandbox: s,
		lang:    lang,
		desc:    desc,
		ch:      make(chan string, s.cfg.SandboxPoolSize),
		size:    s.cfg.SandboxPoolSize,
	}
	s.pools[lang] = p
	go p.replenish(s.bgCtx)
	return p
}

// replenish keeps the pool's channel topped up to its configured size,
// running for as long as the Sandbox itself is alive.
func (p *pool) replenish(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if len(p.ch) >= p.size {
			select {
			case <-ctx.Done():
				return
			case <-time.After(200 * time.Millisecond):
				continue
			}
		}
		name, err := p.sandbox.createPod(ctx, p.desc, p.lang)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Warn().Err(err).Str("language", string(p.lang)).Msg("sandbox pool: failed to create replacement pod, retrying")
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			continue
		}
		select {
		case p.ch <- name:
		case <-ctx.Done():
			_ = p.sandbox.deletePod(context.Background(), name)
			return
		}
	}
}

// checkout takes a ready pod off the pool. If the pool is empty for longer
// than SandboxPoolCheckoutTimeout (a burst that's outpaced replenishment),
// falls back to creating a pod on demand for this one submission - eating
// the 1-3s Pod-start latency rather than blocking indefinitely.
func (p *pool) checkout(ctx context.Context) (string, error) {
	checkoutCtx, cancel := context.WithTimeout(ctx, p.sandbox.cfg.SandboxPoolCheckoutTimeout)
	defer cancel()
	select {
	case name := <-p.ch:
		return name, nil
	case <-checkoutCtx.Done():
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		log.Warn().Str("language", string(p.lang)).Msg("sandbox pool exhausted, falling back to on-demand pod creation")
		return p.sandbox.createPod(ctx, p.desc, p.lang)
	}
}

// createPod creates a fresh pod for lang and blocks until it's Running (or
// the startup timeout elapses).
func (s *Sandbox) createPod(ctx context.Context, desc *langDescriptor, lang domain.Language) (string, error) {
	pod := buildPodSpec(s.cfg, desc, lang)
	created, err := s.clientset.CoreV1().Pods(s.cfg.K8sNamespace).Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		return "", fmt.Errorf("create pod: %w", err)
	}
	if err := s.waitForRunning(ctx, created.Name); err != nil {
		_ = s.deletePod(context.Background(), created.Name)
		return "", err
	}
	return created.Name, nil
}

func (s *Sandbox) waitForRunning(ctx context.Context, name string) error {
	return wait.PollUntilContextTimeout(ctx, 150*time.Millisecond, s.cfg.SandboxPodStartupTimeout, true, func(ctx context.Context) (bool, error) {
		pod, err := s.clientset.CoreV1().Pods(s.cfg.K8sNamespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return false, nil // transient API error - keep polling until the timeout
		}
		if pod.Status.Phase == corev1.PodFailed {
			return false, fmt.Errorf("pod %s failed to start: %s", name, pod.Status.Reason)
		}
		return pod.Status.Phase == corev1.PodRunning, nil
	})
}

func (s *Sandbox) deletePod(ctx context.Context, name string) error {
	grace := int64(0)
	err := s.clientset.CoreV1().Pods(s.cfg.K8sNamespace).Delete(ctx, name, metav1.DeleteOptions{GracePeriodSeconds: &grace})
	if err != nil {
		return fmt.Errorf("delete pod %s: %w", name, err)
	}
	return nil
}
