#!/bin/bash
# Installs the pre-generated TLS cert/key and a custom pg_hba.conf
# (hostssl-only, see infra/postgres/pg_hba.conf) into the data directory.
# Runs as the postgres user already (docker-entrypoint-initdb.d convention),
# so a plain chmod is enough - Postgres refuses to start if the private key
# has any group/world access, but no chown is needed since files copied here
# are already owned by whoever is running this script.
set -e

cp /certs-src/server.crt /certs-src/server.key /certs-src/ca.crt "$PGDATA/"
chmod 600 "$PGDATA/server.key"
cp /certs-src/pg_hba.conf "$PGDATA/pg_hba.conf"

# SSL is turned on here (postgresql.conf), not via a "-c ssl=on" command-line
# flag in docker-compose - the entrypoint starts a temporary bootstrap server
# to run these very init scripts, using the same command-line flags, which
# would need the cert to already exist before this script has copied it in.
# Appending to postgresql.conf instead only takes effect on the *next*
# server start (the real one, after all init scripts finish), avoiding that
# chicken-and-egg failure.
cat >> "$PGDATA/postgresql.conf" <<EOF
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
ssl_ca_file = 'ca.crt'
EOF

echo "TLS certs, hostssl-only pg_hba.conf, and ssl=on installed into $PGDATA."
