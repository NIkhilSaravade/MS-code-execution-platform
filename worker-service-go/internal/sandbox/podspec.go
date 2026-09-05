package sandbox

import (
	"fmt"
	"strconv"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/domain"
)

// buildPodSpec constructs a pooled sandbox Pod for one language. Every
// security control here has a reason - do not remove any without
// understanding the implication (mirrors the old buildDockerArgs' warning).
//
// Network isolation (--network none's equivalent) is NOT set here - a Pod
// always gets pod networking, so it's enforced instead by a default-deny-all
// NetworkPolicy applied to the whole cfg.K8sNamespace (see infra/k8s/), which
// requires the cluster's CNI to actually enforce NetworkPolicy (k3s's default
// Flannel does not - see the design note; this needs Calico or similar).
//
// pids-limit (--pids-limit's equivalent) is NOT a per-Pod field - Kubernetes
// only exposes this as a node-wide kubelet setting (--pod-max-pids), applied
// uniformly to every pod on the node. See infra/k8s/README for the kubelet
// flag to set; there is nothing to configure here.
func buildPodSpec(cfg *config.Config, desc *langDescriptor, lang domain.Language) *corev1.Pod {
	memQty := resource.MustParse(fmt.Sprintf("%dMi", cfg.SandboxMemoryMB))
	cpuQty := resource.MustParse(strconv.FormatFloat(cfg.SandboxCPUQuota, 'f', -1, 64))
	tmpSize := resource.MustParse("64Mi")

	runAsUser := int64(65534) // "nobody" on most distros, same UID the old Docker containers ran as
	runAsNonRoot := true
	allowPrivEsc := false
	readOnlyRootFS := true
	automountSAToken := false
	enableServiceLinks := false

	seccomp := &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault}
	if cfg.SandboxSeccompProfile != "" {
		// Must exist at /var/lib/kubelet/seccomp/<this path> on every node -
		// see infra/k8s/README for how the profile gets provisioned there
		// (no in-image path like Docker's /etc/docker/seccomp anymore).
		localPath := cfg.SandboxSeccompProfile
		seccomp = &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeLocalhost, LocalhostProfile: &localPath}
	}

	var runtimeClassName *string
	if cfg.SandboxRuntimeClassName != "" {
		runtimeClassName = &cfg.SandboxRuntimeClassName
	}

	env := make([]corev1.EnvVar, 0, len(desc.Env))
	for _, kv := range desc.Env {
		k, v, _ := strings.Cut(kv, "=")
		env = append(env, corev1.EnvVar{Name: k, Value: v})
	}

	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: fmt.Sprintf("sandbox-%s-", lang),
			Namespace:    cfg.K8sNamespace,
			Labels: map[string]string{
				"app.kubernetes.io/component": "sandbox",
				"sandbox.platform/language":   string(lang),
			},
		},
		Spec: corev1.PodSpec{
			RuntimeClassName:             runtimeClassName,
			AutomountServiceAccountToken: &automountSAToken,
			EnableServiceLinks:           &enableServiceLinks,
			RestartPolicy:                corev1.RestartPolicyNever,
			SecurityContext: &corev1.PodSecurityContext{
				RunAsUser:    &runAsUser,
				RunAsGroup:   &runAsUser,
				RunAsNonRoot: &runAsNonRoot,
				// FSGroup makes kubelet chown the emptyDir mounts' group to
				// this GID (with the setgid bit) so the non-root container
				// user can actually write into them - the equivalent of the
				// old entrypoint.sh's manual chown, done by kubelet instead.
				FSGroup: &runAsUser,
			},
			Containers: []corev1.Container{
				{
					Name: sandboxContainerName,
					// A trivial holder process - this container is never the
					// thing being judged. All real work happens via exec
					// (compile, then once per test case) - see sandbox.go.
					Image:   desc.Image,
					Command: []string{"sh", "-c", "sleep infinity"},
					Env:     env,
					SecurityContext: &corev1.SecurityContext{
						AllowPrivilegeEscalation: &allowPrivEsc,
						ReadOnlyRootFilesystem:   &readOnlyRootFS,
						Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
						SeccompProfile:           seccomp,
					},
					Resources: corev1.ResourceRequirements{
						Limits: corev1.ResourceList{
							corev1.ResourceMemory: memQty,
							corev1.ResourceCPU:    cpuQty,
						},
						Requests: corev1.ResourceList{
							corev1.ResourceMemory: memQty,
							corev1.ResourceCPU:    cpuQty,
						},
					},
					VolumeMounts: []corev1.VolumeMount{
						{Name: "scratch", MountPath: "/sandbox"},
						{Name: "tmp", MountPath: "/tmp"},
					},
				},
			},
			Volumes: []corev1.Volume{
				// Replaces the old shared named-volume-subpath trick entirely:
				// compile and every test-case exec now run as separate exec
				// calls into the SAME container, so they already share this
				// filesystem without any cross-container mount plumbing.
				{Name: "scratch", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
				// Memory-backed, mirroring the old --tmpfs /tmp:size=64m,noexec,nosuid.
				{Name: "tmp", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{
					Medium:    corev1.StorageMediumMemory,
					SizeLimit: &tmpSize,
				}}},
			},
		},
	}
}
