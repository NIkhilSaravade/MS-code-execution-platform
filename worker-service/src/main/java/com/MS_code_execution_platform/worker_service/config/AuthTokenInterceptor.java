package com.MS_code_execution_platform.worker_service.config;

import com.MS_code_execution_platform.worker_service.client.AuthTokenClient;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.stereotype.Component;

import java.io.IOException;

/** Attaches a service access token to every outgoing RestTemplate call. */
@Component
@RequiredArgsConstructor
public class AuthTokenInterceptor implements ClientHttpRequestInterceptor {

    private final AuthTokenClient authTokenClient;

    @Override
    public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution) throws IOException {
        request.getHeaders().setBearerAuth(authTokenClient.getAccessToken());
        return execution.execute(request, body);
    }
}
