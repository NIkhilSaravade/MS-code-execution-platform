package com.MS_code_execution_platform.auth_service.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * Registry of machine identities allowed to use the client-credentials grant
 * (see ServiceTokenController). Config-based rather than a DB table - this is
 * meant for a handful of internal services, not dynamic client management.
 * For that scale, a real IdP (Keycloak/Auth0) or Spring Authorization Server
 * would replace this.
 */
@Component
@ConfigurationProperties(prefix = "service-clients")
@Data
public class ServiceClientsProperties {

    private Map<String, ServiceClientDefinition> clients = new HashMap<>();

    @Data
    public static class ServiceClientDefinition {
        private String secret;
        private String role;
    }
}
