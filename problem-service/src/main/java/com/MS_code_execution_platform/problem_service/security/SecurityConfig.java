package com.MS_code_execution_platform.problem_service.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {

        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(request -> request
                        .requestMatchers("/actuator/health").permitAll()
                        .requestMatchers("/internal/**").hasRole("SERVICE")
                        // Order matters: specific rules must come before the general
                        // /problems/** rule below, or the broader match would win first.
                        .requestMatchers(HttpMethod.POST, "/problems").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.PUT, "/problems/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.DELETE, "/problems/**").hasRole("ADMIN")
                        // submission-service's HarnessApplier fetches GET /problems/{id}
                        // (for harnessByLanguage) using its own service-credential token,
                        // not a forwarded user token - /internal/** doesn't expose this
                        // (only test-cases/limits), so it has to be this route. GET
                        // /problems/{id}/testcases stays ADMIN-only regardless of this,
                        // via its own @PreAuthorize on
                        // ProblemService.getTestCasesForWorker - that's the real
                        // hidden-test-case gate, not this route-level rule.
                        .requestMatchers(HttpMethod.GET, "/problems/**").hasAnyRole("USER", "ADMIN", "SERVICE")
                        .requestMatchers("/problems/**").hasAnyRole("USER", "ADMIN")
                        // Practice page's 2D "Board" (whimsical-style) view - each user
                        // reads/writes only their own cards/edges/positions (enforced in
                        // BoardCardService/BoardConnectionService/BoardPositionService),
                        // so any authenticated USER/ADMIN may hit these routes.
                        .requestMatchers("/board/**").hasAnyRole("USER", "ADMIN")
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())));

        return http.build();
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authorities = new JwtGrantedAuthoritiesConverter();
        authorities.setAuthoritiesClaimName("roles");
        authorities.setAuthorityPrefix("ROLE_");

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authorities);
        return converter;
    }
}
