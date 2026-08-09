package com.MS_code_execution_platform.solution_service.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    // Separate, narrowly-matched chain (evaluated first via @Order) just for
    // the visualizer: Spring Security's default X-Frame-Options: DENY header
    // blocks the browser from rendering it inside SolvePage's <iframe> at
    // all, clickjacking protection or not - disabling it only for this one
    // path (not the whole service) keeps every other response protected.
    @Bean
    @Order(1)
    public SecurityFilterChain visualizerFilterChain(HttpSecurity http) throws Exception {
        http
                // GET only - the path-only overload of securityMatcher would
                // also catch the ADMIN-only POST upload endpoint at this
                // same path, bypassing its role check.
                .securityMatcher(new AntPathRequestMatcher("/solutions/problem/*/visualizer", "GET"))
                .csrf(csrf -> csrf.disable())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(request -> request.anyRequest().permitAll())
                .headers(headers -> headers.frameOptions(frameOptions -> frameOptions.disable()));

        return http.build();
    }

    @Bean
    @Order(2)
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {

        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(request -> request
                        .requestMatchers("/actuator/health").permitAll()
                        // Order matters: specific write rules before the general read rule.
                        .requestMatchers(HttpMethod.POST, "/solutions/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.DELETE, "/solutions/**").hasRole("ADMIN")
                        // Notes are a regular user's own content (scoped by JWT subject in
                        // the controller, not ADMIN-gated) - any authenticated USER/ADMIN
                        // may write their own.
                        .requestMatchers(HttpMethod.PUT, "/solutions/problem/*/notes").hasAnyRole("USER", "ADMIN")
                        .requestMatchers(HttpMethod.GET, "/solutions/**").hasAnyRole("USER", "ADMIN")
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
