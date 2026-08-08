package com.MS_code_execution_platform.submission_service.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

@Configuration
@RequiredArgsConstructor
public class RestTemplateConfig {

    private final AuthTokenInterceptor authTokenInterceptor;

    @Bean
    public RestTemplate restTemplate() {
        RestTemplate restTemplate = new RestTemplate();
        restTemplate.getInterceptors().add(authTokenInterceptor);
        return restTemplate;
    }
}
