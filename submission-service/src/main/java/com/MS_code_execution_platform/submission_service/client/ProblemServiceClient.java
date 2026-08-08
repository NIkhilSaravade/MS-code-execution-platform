package com.MS_code_execution_platform.submission_service.client;

import com.MS_code_execution_platform.submission_service.dto.ProblemDetails;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/**
 * Fetches a problem's details (including its generated harness, if any) from
 * problem-service before a submission is judged - see HarnessApplier.
 * Authenticated the same way worker-service-go/worker-service call
 * problem-service: a service-credential token via the intercepted
 * RestTemplate bean (see RestTemplateConfig/AuthTokenInterceptor).
 */
@Component
@RequiredArgsConstructor
public class ProblemServiceClient {

    private final RestTemplate restTemplate;

    @Value("${problem-service.url}")
    private String problemServiceUrl;

    public ProblemDetails getProblem(Long problemId) {
        return restTemplate.getForObject(
                problemServiceUrl + "/problems/" + problemId,
                ProblemDetails.class);
    }
}
