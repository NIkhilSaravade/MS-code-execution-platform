package com.MS_code_execution_platform.auth_service.service;

import com.MS_code_execution_platform.auth_service.entity.RefreshToken;
import com.MS_code_execution_platform.auth_service.exception.InvalidCredentialsException;
import com.MS_code_execution_platform.auth_service.repository.RefreshTokenRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;

/**
 * Owns token issuance and storage. Access tokens are stateless RS256 JWTs
 * (can't be revoked before exp, so kept short-lived). Refresh tokens are
 * opaque random strings; only their SHA-256 hash is persisted, and each one
 * is single-use — reuse of an already-consumed refresh token revokes the
 * whole family, since that can only mean it was stolen.
 */
@Service
@RequiredArgsConstructor
public class TokenService {

    private final JwtEncoder jwtEncoder;
    private final RefreshTokenRepository refreshTokenRepository;

    @Value("${jwt.issuer}")
    private String issuer;

    @Value("${jwt.audience}")
    private String audience;

    @Value("${jwt.access-token-ttl-minutes}")
    private long accessTokenTtlMinutes;

    @Value("${jwt.refresh-token-ttl-days}")
    private long refreshTokenTtlDays;

    public String issueAccessToken(String userId, String email, String role) {
        Instant now = Instant.now();

        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .audience(List.of(audience))
                .subject(userId)
                .issuedAt(now)
                .expiresAt(now.plus(accessTokenTtlMinutes, ChronoUnit.MINUTES))
                .claim("email", email)
                .claim("roles", List.of(role))
                .build();

        return jwtEncoder.encode(JwtEncoderParameters.from(claims)).getTokenValue();
    }

    // Client-credentials grant: the token represents the calling service itself,
    // not a user acting through it - no 'email' claim, subject is the client id.
    public String issueServiceAccessToken(String clientId, String role) {
        Instant now = Instant.now();

        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .audience(List.of(audience))
                .subject(clientId)
                .issuedAt(now)
                .expiresAt(now.plus(accessTokenTtlMinutes, ChronoUnit.MINUTES))
                .claim("roles", List.of(role))
                .claim("client_id", clientId)
                .build();

        return jwtEncoder.encode(JwtEncoderParameters.from(claims)).getTokenValue();
    }

    public long getAccessTokenTtlSeconds() {
        return accessTokenTtlMinutes * 60;
    }

    @Transactional
    public String issueRefreshToken(String userId) {
        String raw = generateSecureRandomToken();

        RefreshToken entity = RefreshToken.builder()
                .tokenHash(sha256(raw))
                .userId(userId)
                .expiresAt(Instant.now().plus(refreshTokenTtlDays, ChronoUnit.DAYS))
                .used(false)
                .build();

        refreshTokenRepository.save(entity);
        return raw;
    }

    @Transactional
    public String consumeRefreshToken(String rawToken) {
        RefreshToken stored = refreshTokenRepository.findByTokenHash(sha256(rawToken))
                .orElseThrow(() -> new InvalidCredentialsException("Invalid refresh token"));

        if (stored.isUsed()) {
            refreshTokenRepository.revokeAllForUser(stored.getUserId());
            throw new InvalidCredentialsException("Refresh token reuse detected");
        }

        if (stored.getExpiresAt().isBefore(Instant.now())) {
            throw new InvalidCredentialsException("Refresh token expired");
        }

        stored.setUsed(true);
        refreshTokenRepository.save(stored);
        return stored.getUserId();
    }

    private String generateSecureRandomToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
