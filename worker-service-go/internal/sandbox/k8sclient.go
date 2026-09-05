package sandbox

import (
	"fmt"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
)

// buildK8sClient builds the REST config + clientset the sandbox package uses
// to create/exec/delete Pods. In the real cluster this reads the Pod's own
// mounted ServiceAccount token (in-cluster config); for local development
// against a kubeconfig, set K8S_IN_CLUSTER=false and KUBECONFIG_PATH.
func buildK8sClient(cfg *config.Config) (*rest.Config, *kubernetes.Clientset, error) {
	var restCfg *rest.Config
	var err error
	if cfg.K8sInCluster {
		restCfg, err = rest.InClusterConfig()
		if err != nil {
			return nil, nil, fmt.Errorf("in-cluster config: %w", err)
		}
	} else {
		restCfg, err = clientcmd.BuildConfigFromFlags("", cfg.K8sKubeconfigPath)
		if err != nil {
			return nil, nil, fmt.Errorf("kubeconfig %q: %w", cfg.K8sKubeconfigPath, err)
		}
	}

	clientset, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		return nil, nil, fmt.Errorf("build clientset: %w", err)
	}
	return restCfg, clientset, nil
}
