package kafka

import (
	"os"
	"testing"
)

func TestBuildTLSConfig_RealCACert(t *testing.T) {
	tlsConfig, err := buildTLSConfig("../../../infra/kafka/certs/ca.crt")
	if err != nil {
		t.Fatalf("expected the real CA cert to load, got: %v", err)
	}
	if tlsConfig.RootCAs == nil {
		t.Fatal("expected RootCAs to be populated")
	}
	if len(tlsConfig.RootCAs.Subjects()) == 0 { //nolint:staticcheck // Subjects() deprecated but fine for this sanity check
		t.Fatal("expected at least one CA subject in the pool")
	}
}

func TestBuildTLSConfig_MissingFile(t *testing.T) {
	_, err := buildTLSConfig("/nonexistent/ca.crt")
	if err == nil {
		t.Fatal("expected an error for a missing cert file, got nil")
	}
}

func TestBuildTLSConfig_InvalidPEM(t *testing.T) {
	tmp := t.TempDir() + "/not-a-cert.pem"
	if err := os.WriteFile(tmp, []byte("this is not a certificate"), 0o600); err != nil {
		t.Fatalf("setup: %v", err)
	}
	_, err := buildTLSConfig(tmp)
	if err == nil {
		t.Fatal("expected an error for invalid PEM content, got nil")
	}
}

func TestBuildSASLMechanism(t *testing.T) {
	m := buildSASLMechanism("worker", "worker-dev-secret")
	if m.Username != "worker" || m.Password != "worker-dev-secret" {
		t.Fatalf("unexpected mechanism values: %+v", m)
	}
}
