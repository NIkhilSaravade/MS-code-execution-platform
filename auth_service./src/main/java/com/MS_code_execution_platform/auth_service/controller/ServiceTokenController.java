package com.MS_code_execution_platform.auth_service.controller;

import com.MS_code_execution_platform.auth_service.dto.ClientCredentialsTokenResponse;
import com.MS_code_execution_platform.auth_service.exception.InvalidCredentialsException;
import com.MS_code_execution_platform.auth_service.service.ServiceAuthService;
import com.MS_code_execution_platform.auth_service.service.TokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * OAuth2 client-credentials grant endpoint (RFC 6749 section 4.4) for
 * service-to-service callers (e.g. worker-service). Distinct from
 * AuthController, which handles end-user login/register/refresh.
 */
@RestController
@RequiredArgsConstructor
public class ServiceTokenController {

    private final ServiceAuthService serviceAuthService;
    private final TokenService tokenService;

    @PostMapping(value = "/auth/token", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
    public ClientCredentialsTokenResponse token(
            @RequestParam("grant_type") String grantType,
            @RequestParam("client_id") String clientId,
            @RequestParam("client_secret") String clientSecret) {

        if (!"client_credentials".equals(grantType)) {
            throw new InvalidCredentialsException("Unsupported grant_type: " + grantType);
        }

        String accessToken = serviceAuthService.authenticate(clientId, clientSecret);

        return ClientCredentialsTokenResponse.builder()
                .accessToken(accessToken)
                .tokenType("Bearer")
                .expiresIn(tokenService.getAccessTokenTtlSeconds())
                .build();
    }
}
