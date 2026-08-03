#!/bin/bash
# Runs once, on first container start (empty data directory), via Postgres's
# own /docker-entrypoint-initdb.d convention.
#
# Per Java service: one "owner" role (creates/owns the database - full DDL
# rights on its own DB only, NOT a Postgres superuser - used exclusively by
# Flyway to run migrations) and one "app" role (DML only:
# SELECT/INSERT/UPDATE/DELETE, no DDL, used by the running application at
# runtime). A compromised app role's credentials get you data in one
# database, never schema control, and never another service's database at
# all - CONNECT is revoked from PUBLIC first, so nothing connects anywhere
# without an explicit grant.
#
# ai_analysis_db (Python/SQLAlchemy, no Flyway-equivalent migration tool set
# up here) only gets an owner role - see docker-compose.yml's note on this.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
EOSQL

create_service_db() {
  local db="$1"
  local owner_role="$2"
  local owner_password="$3"
  local app_role="$4"
  local app_password="$5"

  echo "Provisioning database: $db (owner=$owner_role, app=$app_role)"

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE ROLE $owner_role WITH LOGIN PASSWORD '$owner_password';
    CREATE ROLE $app_role WITH LOGIN PASSWORD '$app_password';

    CREATE DATABASE $db OWNER $owner_role;
    REVOKE CONNECT ON DATABASE $db FROM PUBLIC;
    GRANT CONNECT ON DATABASE $db TO $owner_role, $app_role;
EOSQL

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
    -- CREATE DATABASE ... OWNER only makes owner_role own the database, not
    -- the 'public' schema inside it - that's still owned by whichever role
    -- ran CREATE DATABASE. Reassign it, or the REVOKE below locks the owner
    -- role out of its own database's schema too (caught by testing this).
    ALTER SCHEMA public OWNER TO $owner_role;

    -- Some Postgres versions grant CREATE on the public schema to PUBLIC by
    -- default, which would let the app role create its own tables directly -
    -- revoke it explicitly rather than relying on the version's default.
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO $app_role;

    -- DML only on whatever tables already exist (usually none yet - Flyway
    -- hasn't run at this point).
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $app_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $app_role;

    -- ...and automatically the same for every table/sequence the owner
    -- creates from now on (every future Flyway migration), so the app role
    -- never needs a fresh grant after a schema change.
    ALTER DEFAULT PRIVILEGES FOR ROLE $owner_role IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $app_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE $owner_role IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO $app_role;
EOSQL
}

# Python service, no Flyway-equivalent - the app connects as the owner role
# directly, since it needs DDL rights to run Base.metadata.create_all() itself.
create_owner_only_db() {
  local db="$1"
  local owner_role="$2"
  local owner_password="$3"

  echo "Provisioning database: $db (owner=$owner_role, no separate app role)"

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE ROLE $owner_role WITH LOGIN PASSWORD '$owner_password';
    CREATE DATABASE $db OWNER $owner_role;
    REVOKE CONNECT ON DATABASE $db FROM PUBLIC;
    GRANT CONNECT ON DATABASE $db TO $owner_role;
EOSQL
}

create_service_db "user_service" \
  "user_service_owner" "${USER_SERVICE_DB_OWNER_PASSWORD:-user-service-owner-dev-secret}" \
  "user_service_app" "${USER_SERVICE_DB_APP_PASSWORD:-user-service-app-dev-secret}"

create_service_db "auth_service" \
  "auth_service_owner" "${AUTH_SERVICE_DB_OWNER_PASSWORD:-auth-service-owner-dev-secret}" \
  "auth_service_app" "${AUTH_SERVICE_DB_APP_PASSWORD:-auth-service-app-dev-secret}"

create_service_db "problem_service" \
  "problem_service_owner" "${PROBLEM_SERVICE_DB_OWNER_PASSWORD:-problem-service-owner-dev-secret}" \
  "problem_service_app" "${PROBLEM_SERVICE_DB_APP_PASSWORD:-problem-service-app-dev-secret}"

create_service_db "submission_service" \
  "submission_service_owner" "${SUBMISSION_SERVICE_DB_OWNER_PASSWORD:-submission-service-owner-dev-secret}" \
  "submission_service_app" "${SUBMISSION_SERVICE_DB_APP_PASSWORD:-submission-service-app-dev-secret}"

create_service_db "execution_result_service" \
  "execution_result_service_owner" "${EXECUTION_RESULT_SERVICE_DB_OWNER_PASSWORD:-execution-result-service-owner-dev-secret}" \
  "execution_result_service_app" "${EXECUTION_RESULT_SERVICE_DB_APP_PASSWORD:-execution-result-service-app-dev-secret}"

create_owner_only_db "ai_analysis_db" \
  "ai_analysis_owner" "${AI_ANALYSIS_DB_OWNER_PASSWORD:-ai-analysis-owner-dev-secret}"
