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

echo "TLS certs and hostssl-only pg_hba.conf installed into $PGDATA."
