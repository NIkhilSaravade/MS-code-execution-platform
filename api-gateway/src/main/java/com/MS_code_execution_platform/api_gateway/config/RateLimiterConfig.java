package com.MS_code_execution_platform.api_gateway.config;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import reactor.core.publisher.Mono;

@Configuration
public class RateLimiterConfig {

    // Keys the Redis-backed RequestRateLimiter (see application.yml's
    // submission-service/execution-result-service routes) by the caller's
    // JWT subject, so one user can't get around their own limit by hitting
    // the endpoint from multiple IPs/devices - only an unauthenticated
    // request (there shouldn't be any reaching a rate-limited route, since
    // every route past /auth/** requires a valid JWT) falls back to remote
    // address, purely as a safety net rather than the primary key.
    @Bean
    public KeyResolver userKeyResolver() {
        return exchange -> ReactiveSecurityContextHolder.getContext()
                .map(ctx -> ctx.getAuthentication().getName())
                .switchIfEmpty(Mono.just(
                        exchange.getRequest().getRemoteAddress() != null
                                ? exchange.getRequest().getRemoteAddress().getAddress().getHostAddress()
                                : "unknown"));
    }
}
