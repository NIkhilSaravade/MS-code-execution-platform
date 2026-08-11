import os
import time
import httpx

from discovery.service_resolver import get_service_url

# Mirrors the Java services' client.AuthTokenClient pattern: this service
# authenticates as itself (OAuth2 client-credentials) rather than forwarding
# a user's token, for the Kafka-triggered analysis path (analysis.trigger.v1),
# which has no inbound HTTP request to forward a token from - see
# auth-service's service-clients.clients.ai-analysis-service config.

_CLIENT_ID = os.getenv("AI_ANALYSIS_SERVICE_CLIENT_ID", "ai-analysis-service")
_CLIENT_SECRET = os.getenv("AI_ANALYSIS_SERVICE_CLIENT_SECRET", "dev-only-secret-change-me")

# 30s refresh skew, same margin the Java AuthTokenClient uses.
_REFRESH_SKEW_SECONDS = 30

_cached_token: str | None = None
_cached_expiry: float = 0.0


async def get_service_token() -> str:
    global _cached_token, _cached_expiry

    now = time.time()
    if _cached_token and now < _cached_expiry - _REFRESH_SKEW_SECONDS:
        return _cached_token

    auth_service_url = await get_service_url("AUTH-SERVICE")

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{auth_service_url}/auth/token",
            data={
                "grant_type": "client_credentials",
                "client_id": _CLIENT_ID,
                "client_secret": _CLIENT_SECRET,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()
        body = response.json()

    _cached_token = body["access_token"]
    _cached_expiry = now + body.get("expires_in", 900)
    return _cached_token
