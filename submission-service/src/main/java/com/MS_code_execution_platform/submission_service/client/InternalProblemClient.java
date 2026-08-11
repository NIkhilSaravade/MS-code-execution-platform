package com.MS_code_execution_platform.submission_service.client;

import com.MS_code_execution_platform.submission_service.dto.InternalLimitsResponse;
import com.MS_code_execution_platform.submission_service.dto.InternalTestCasesResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/**
 * Fetches test cases + judging limits from problem-service's internal,
 * service-token-only API (the same endpoints worker-service-go used to call
 * itself) so they can be embedded into SubmissionCreatedEvent - the worker no
 * longer needs to call problem-service per submission. Reuses the same
 * intercepted RestTemplate (see RestTemplateConfig/AuthTokenInterceptor) as
 * ProblemServiceClient.
 */
@Component
@RequiredArgsConstructor
public class InternalProblemClient {

    private final RestTemplate restTemplate;

    @Value("${problem-service.url}")
    private String problemServiceUrl;

    public InternalTestCasesResponse getTestCases(Long problemId) {
        return restTemplate.getForObject(
                problemServiceUrl + "/internal/problem-versions/" + problemId + "/test-cases",
                InternalTestCasesResponse.class);
    }

    public InternalLimitsResponse getLimits(Long problemId) {
        return restTemplate.getForObject(
                problemServiceUrl + "/internal/problems/" + problemId + "/limits",
                InternalLimitsResponse.class);
    }
}
