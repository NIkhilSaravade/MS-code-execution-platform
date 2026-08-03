package com.MS_code_execution_platform.worker_service.client;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Verifies the client-credentials fetch/cache logic for real against a
 * throwaway HTTP server standing in for auth-service's /auth/token endpoint -
 * mirrors worker-service-go's internal/auth token_source_test.go coverage.
 */
class AuthTokenClientTest {

    private HttpServer server;
    private AtomicInteger requestCount;

    @BeforeEach
    void startFakeAuthService() throws IOException {
        requestCount = new AtomicInteger(0);
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/auth/token", exchange -> {
            requestCount.incrementAndGet();
            String body = "{\"access_token\":\"fake-token-" + requestCount.get()
                    + "\",\"token_type\":\"Bearer\",\"expires_in\":900}";
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        });
        server.start();
    }

    @AfterEach
    void stopFakeAuthService() {
        server.stop(0);
    }

    private AuthTokenClient newClient() {
        AuthTokenClient client = new AuthTokenClient();
        int port = server.getAddress().getPort();
        ReflectionTestUtils.setField(client, "authServiceUrl", "http://127.0.0.1:" + port);
        ReflectionTestUtils.setField(client, "clientId", "worker-service");
        ReflectionTestUtils.setField(client, "clientSecret", "worker-dev-secret");
        return client;
    }

    @Test
    void fetchesAndReturnsAnAccessToken() {
        AuthTokenClient client = newClient();
        String token = client.getAccessToken();
        assertNotNull(token);
        assertEquals("fake-token-1", token);
    }

    @Test
    void cachesTheTokenInsteadOfRefetchingOnEveryCall() {
        AuthTokenClient client = newClient();
        String first = client.getAccessToken();
        String second = client.getAccessToken();
        assertEquals(first, second);
        assertEquals(1, requestCount.get(), "expected exactly one HTTP call to /auth/token");
    }
}
