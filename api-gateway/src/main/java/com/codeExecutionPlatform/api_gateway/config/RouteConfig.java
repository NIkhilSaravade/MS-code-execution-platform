package com.codeExecutionPlatform.api_gateway.config;

import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RouteConfig {

    @Bean
    public RouteLocator routes(RouteLocatorBuilder builder) {
        return builder.routes()
                .route("user", r -> r.path("/auth/**")
                        .uri("http://localhost:8084"))
                .route("submission", r -> r.path("/submissions/**")
                        .uri("http://localhost:8081"))
                .route("results", r -> r.path("/results/**")
                        .uri("http://localhost:8083"))
                .build();
    }
}

