package com.MS_code_execution_platform.worker_service.client;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.Map;

/**
 * OAuth2 client-credentials grant against auth-service's /auth/token
 * (RFC 6749 section 4.4) - this worker authenticates as itself, not on
 * behalf of a user, since it has no inbound HTTP request to forward a
 * token from. Mirrors worker-service-go's internal/auth.TokenSource.
 *
 * Uses its own plain RestTemplate (not the interceptor-enabled bean from
 * RestTemplateConfig) since /auth/token itself is unauthenticated - using
 * the intercepted bean here would be circular.
 */
@Component
public class AuthTokenClient {

    private static final long REFRESH_SKEW_SECONDS = 30;

    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${auth-service.url}")
    private String authServiceUrl;

    @Value("${worker.client-id}")
    private String clientId;

    @Value("${worker.client-secret}")
    private String clientSecret;

    private volatile String cachedToken;
    private volatile Instant expiresAt = Instant.EPOCH;

    public synchronized String getAccessToken() {

        if (cachedToken != null && Instant.now().isBefore(expiresAt.minusSeconds(REFRESH_SKEW_SECONDS))) {
            return cachedToken;
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "client_credentials");
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);

        @SuppressWarnings("unchecked")
        Map<String, Object> response = restTemplate.postForObject(
                authServiceUrl + "/auth/token", new HttpEntity<>(form, headers), Map.class);

        if (response == null || response.get("access_token") == null) {
            throw new IllegalStateException("auth-service returned an empty access_token");
        }

        cachedToken = (String) response.get("access_token");
        expiresAt = Instant.now().plusSeconds(((Number) response.get("expires_in")).longValue());

        return cachedToken;
    }
}
