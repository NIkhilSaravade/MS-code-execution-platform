package com.MS_code_execution_platform.auth_service.config;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.proc.SecurityContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/**
 * Loads the issuer's RSA keypair and wires up an RS256 {@link JwtEncoder}.
 * The 'kid' is a stable, configured value (not random) so that restarting
 * this service doesn't invalidate outstanding tokens against the JWKS it serves.
 */
@Configuration
public class JwtKeyConfig {

    // Resolves "keys/jwt-public.pem" (no prefix) against the classpath, same
    // as before, but also honors an explicit "file:" prefix - lets the
    // private key be mounted from a k8s Secret instead of baked into the
    // jar, without changing anything for local/dev config.
    private final ResourceLoader resourceLoader = new DefaultResourceLoader();

    @Value("${jwt.private-key-path}")
    private String privateKeyPath;

    @Value("${jwt.public-key-path}")
    private String publicKeyPath;

    @Value("${jwt.key-id}")
    private String keyId;

    @Bean
    public RSAKey rsaKey() throws Exception {
        RSAPublicKey publicKey = readPublicKey(publicKeyPath);
        RSAPrivateKey privateKey = readPrivateKey(privateKeyPath);

        return new RSAKey.Builder(publicKey)
                .privateKey(privateKey)
                .keyID(keyId)
                .build();
    }

    @Bean
    public JwtEncoder jwtEncoder(RSAKey rsaKey) {
        JWKSet jwkSet = new JWKSet(rsaKey);
        var jwkSource = new ImmutableJWKSet<SecurityContext>(jwkSet);
        return new NimbusJwtEncoder(jwkSource);
    }

    private RSAPublicKey readPublicKey(String path) throws Exception {
        byte[] decoded = Base64.getDecoder().decode(stripPemHeaders(path));
        X509EncodedKeySpec spec = new X509EncodedKeySpec(decoded);
        return (RSAPublicKey) KeyFactory.getInstance("RSA").generatePublic(spec);
    }

    private RSAPrivateKey readPrivateKey(String path) throws Exception {
        byte[] decoded = Base64.getDecoder().decode(stripPemHeaders(path));
        PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(decoded);
        return (RSAPrivateKey) KeyFactory.getInstance("RSA").generatePrivate(spec);
    }

    private String stripPemHeaders(String location) throws Exception {
        Resource resource = resourceLoader.getResource(location);
        String pem = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        return pem.replaceAll("-----BEGIN (.*)-----", "")
                .replaceAll("-----END (.*)-----", "")
                .replaceAll("\\s", "");
    }
}
