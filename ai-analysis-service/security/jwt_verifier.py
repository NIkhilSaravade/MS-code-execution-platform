import os

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

# Same RS256 issuer identity every other resource server in the platform
# validates against (see api-gateway/user-service/problem-service/
# submission-service application config).
JWKS_URL = os.getenv("AUTH_SERVICE_JWKS_URL", "http://localhost:8086/.well-known/jwks.json")
JWT_ISSUER = os.getenv("JWT_ISSUER", "https://auth-service")
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "ms-code-execution")

# PyJWKClient fetches and caches the JWKS itself (default 5 min cache),
# so this doesn't hit auth-service on every request.
_jwk_client = PyJWKClient(JWKS_URL)


def verify_token(token: str) -> dict:
    """Verifies signature, issuer, audience and expiry. Raises HTTPException(401) on failure."""
    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc


async def get_current_claims(authorization: str = Header(None)) -> dict:
    """FastAPI dependency: verifies the caller's bearer token independently of
    whatever the gateway already checked (defense in depth - this service never
    trusts an Authorization header just because it's present)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

    token = authorization.split(" ", 1)[1]
    return verify_token(token)
