package com.MS_code_execution_platform.auth_service.service;

import com.MS_code_execution_platform.auth_service.config.ServiceClientsProperties;
import com.MS_code_execution_platform.auth_service.exception.InvalidCredentialsException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * OAuth2 client-credentials grant (RFC 6749 section 4.4) for service-to-service
 * calls - a worker or job authenticates as itself, not on behalf of a user.
 * Issues an access token only; there is no refresh token in this grant, since
 * the caller can just re-authenticate with its own credentials at any time.
 */
@Service
@RequiredArgsConstructor
public class ServiceAuthService {

    private final TokenService tokenService;
    private final ServiceClientsProperties serviceClientsProperties;

    public String authenticate(String clientId, String clientSecret) {

        ServiceClientsProperties.ServiceClientDefinition client =
                serviceClientsProperties.getClients().get(clientId);

        if (client == null || !constantTimeEquals(clientSecret, client.getSecret())) {
            throw new InvalidCredentialsException("Invalid client credentials");
        }

        return tokenService.issueServiceAccessToken(clientId, client.getRole());
    }

    private boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        return MessageDigest.isEqual(
                a.getBytes(StandardCharsets.UTF_8),
                b.getBytes(StandardCharsets.UTF_8));
    }
}
