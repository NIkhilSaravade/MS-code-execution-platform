package kafka

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"

	"github.com/segmentio/kafka-go/sasl/plain"
)

// buildTLSConfig loads the CA certificate used to verify the Kafka broker's
// certificate. The broker uses a self-signed CA (see infra/kafka/certs) -
// there's no public CA to fall back to, so this fails loudly rather than
// silently skipping verification if the cert can't be loaded.
func buildTLSConfig(caCertPath string) (*tls.Config, error) {
	caCert, err := os.ReadFile(caCertPath)
	if err != nil {
		return nil, fmt.Errorf("read kafka CA cert %s: %w", caCertPath, err)
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caCert) {
		return nil, fmt.Errorf("no valid certificates found in %s", caCertPath)
	}

	return &tls.Config{RootCAs: pool}, nil
}

func buildSASLMechanism(username, password string) plain.Mechanism {
	return plain.Mechanism{Username: username, Password: password}
}
