#!/bin/bash
# Generates self-signed CAs + server certs for Postgres and Kafka's internal
# TLS. Run this once on any machine before `docker-compose up` - the
# private keys it creates (server.key, broker-keystore.pem, *.key) are
# gitignored on purpose and never exist in a fresh clone, so this has to be
# run locally rather than pulled from git.
#
# Re-run it any time the environment's private IP (the SAN below) changes -
# e.g. moving to a new VM - since sslmode=verify-full and Kafka's default
# hostname verification both check the connecting address against the
# cert's SAN, not just its CA chain.
set -e

VM_IP="${VM_IP:-10.0.0.14}"

POSTGRES_DIR="$(dirname "$0")/postgres/certs"
KAFKA_DIR="$(dirname "$0")/kafka/certs"

echo "Generating Postgres CA + server cert (SAN: postgres, localhost, 127.0.0.1, ${VM_IP})..."
openssl genrsa -out "$POSTGRES_DIR/ca.key" 4096
openssl req -x509 -new -nodes -key "$POSTGRES_DIR/ca.key" -sha256 -days 3650 \
  -subj "/CN=ms-code-execution-platform-postgres-ca" \
  -out "$POSTGRES_DIR/ca.crt"

openssl genrsa -out "$POSTGRES_DIR/server.key" 2048
# 644, not 600: this file is read via a bind mount by postgres's container
# user, whose UID doesn't necessarily match the host user that owns it.
# Postgres's own security requirement (reject a world-readable key) is
# enforced on the COPY configure-ssl.sh makes inside $PGDATA, not on this
# host-side file - see infra/postgres/configure-ssl.sh's chmod 600 there.
chmod 644 "$POSTGRES_DIR/server.key"
openssl req -new -key "$POSTGRES_DIR/server.key" -subj "/CN=postgres" -out "$POSTGRES_DIR/server.csr"
openssl x509 -req -in "$POSTGRES_DIR/server.csr" \
  -CA "$POSTGRES_DIR/ca.crt" -CAkey "$POSTGRES_DIR/ca.key" -CAcreateserial \
  -out "$POSTGRES_DIR/server.crt" -days 3650 -sha256 \
  -extfile <(printf "subjectAltName=DNS:postgres,DNS:localhost,IP:127.0.0.1,IP:%s" "$VM_IP")
rm -f "$POSTGRES_DIR/server.csr"

echo "Generating Kafka CA + broker cert (SAN: kafka, localhost, 127.0.0.1, ${VM_IP})..."
openssl genrsa -out "$KAFKA_DIR/ca.key" 4096
openssl req -x509 -new -nodes -key "$KAFKA_DIR/ca.key" -sha256 -days 3650 \
  -subj "/CN=ms-code-execution-platform-ca" \
  -out "$KAFKA_DIR/ca.crt"

openssl genrsa -out "$KAFKA_DIR/broker.key" 2048
openssl req -new -key "$KAFKA_DIR/broker.key" -subj "/CN=kafka" -out "$KAFKA_DIR/broker.csr"
openssl x509 -req -in "$KAFKA_DIR/broker.csr" \
  -CA "$KAFKA_DIR/ca.crt" -CAkey "$KAFKA_DIR/ca.key" -CAcreateserial \
  -out "$KAFKA_DIR/broker.crt" -days 3650 -sha256 \
  -extfile <(printf "subjectAltName=DNS:kafka,DNS:localhost,IP:127.0.0.1,IP:%s" "$VM_IP")
rm -f "$KAFKA_DIR/broker.csr"

# KAFKA_SSL_KEYSTORE_TYPE=PEM expects one file: cert followed by an
# unencrypted PKCS8 private key (see docker-compose.yml's comments on
# KAFKA_SSL_KEY_CREDENTIALS for why it must be unencrypted).
openssl pkcs8 -topk8 -nocrypt -in "$KAFKA_DIR/broker.key" -out "$KAFKA_DIR/broker.key.pk8"
cat "$KAFKA_DIR/broker.crt" "$KAFKA_DIR/broker.key.pk8" > "$KAFKA_DIR/broker-keystore.pem"
rm -f "$KAFKA_DIR/broker.key.pk8"
# 644, not 600: read directly at runtime via a bind mount by Kafka's
# container user, whose UID doesn't necessarily match the host owner.
chmod 644 "$KAFKA_DIR/broker-keystore.pem" "$KAFKA_DIR/broker.key"

echo ""
echo "Done. New CA certs are at:"
echo "  $POSTGRES_DIR/ca.crt"
echo "  $KAFKA_DIR/ca.crt"
echo ""
echo "If Kubernetes pods are already deployed, refresh their trusted CA ConfigMaps:"
echo "  kubectl create configmap postgres-ca-cert -n platform --from-file=postgres-ca.crt=$POSTGRES_DIR/ca.crt --dry-run=client -o yaml | kubectl apply -f -"
echo "  kubectl create configmap kafka-ca-cert -n platform --from-file=ca.crt=$KAFKA_DIR/ca.crt --dry-run=client -o yaml | kubectl apply -f -"
echo "then restart any pods that already cached the old CA:"
echo "  kubectl rollout restart deployment -n platform"
