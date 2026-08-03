-- Matches com.MS_code_execution_platform.user_service.entity.User exactly
-- (Hibernate's default snake_case naming for unannotated columns).
CREATE TABLE users (
    id          uuid PRIMARY KEY,
    email       varchar(255) UNIQUE,
    password    varchar(255),
    role        varchar(255),
    created_at  timestamp,
    modified_at timestamp
);
