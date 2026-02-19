package com.codeExecutionPlatform.api_gateway.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import javax.crypto.SecretKey;
import java.security.Key;

@Component
public class JwtAuthFilter implements WebFilter {

    private final String SECRET = "super-secret-key-should-be-env";

    SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes());


    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {

        String auth = exchange.getRequest().getHeaders().getFirst("Authorization");

        if (auth == null || !auth.startsWith("Bearer ")) {
            return chain.filter(exchange);
        }

        String token = auth.substring(7);

        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();


            exchange.getRequest().mutate()
                    .header("X-USER-ID", claims.getSubject())
                    .build();

        } catch (Exception e) {
            return Mono.error(new RuntimeException("Invalid JWT"));
        }

        return chain.filter(exchange);
    }
}
