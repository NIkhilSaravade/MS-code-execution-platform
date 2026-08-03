-- Matches com.MS_code_execution_platform.auth_service.entity.RefreshToken exactly.
CREATE TABLE refresh_tokens (
    id          uuid PRIMARY KEY,
    token_hash  varchar(255) NOT NULL UNIQUE,
    user_id     varchar(255) NOT NULL,
    expires_at  timestamp NOT NULL,
    used        boolean NOT NULL,
    created_at  timestamp
);
