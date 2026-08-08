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
                        // worker-service (the legacy Java worker) reads test cases via
                        // GET /problems/{id}/testcases with a service-credential token
                        // (ROLE_SERVICE), not a user's - worker-service-go instead uses
                        // /internal/** for the same purpose, but this older worker never
                        // got migrated and was only ever granted USER/ADMIN access here,
                        // so every call 403'd. Read-only, and test case content isn't
                        // sensitive, so extending GET (not the broader /problems/**) to
                        // ROLE_SERVICE is the narrowest fix.
                        .requestMatchers(HttpMethod.GET, "/problems/**").hasAnyRole("USER", "ADMIN", "SERVICE")
                        .requestMatchers("/problems/**").hasAnyRole("USER", "ADMIN")
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
