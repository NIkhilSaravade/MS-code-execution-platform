package com.MS_code_execution_platform.problem_service.controller;

import com.MS_code_execution_platform.problem_service.dto.InternalLimitsResponse;
import com.MS_code_execution_platform.problem_service.dto.InternalTestCaseDTO;
import com.MS_code_execution_platform.problem_service.dto.InternalTestCasesResponse;
import com.MS_code_execution_platform.problem_service.entity.Problem;
import com.MS_code_execution_platform.problem_service.entity.TestCase;
import com.MS_code_execution_platform.problem_service.service.ProblemService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Service-to-service API for worker-service-go, authenticated with a service
 * access token (client-credentials grant, ROLE_SERVICE) - see SecurityConfig.
 * Not reachable with an ordinary user token.
 */
@RestController
@RequestMapping("/internal")
@RequiredArgsConstructor
public class InternalProblemController {

    private static final int DEFAULT_TIME_LIMIT_MS = 2000;
    private static final int DEFAULT_MEMORY_LIMIT_MB = 256;
    private static final int DEFAULT_WEIGHT = 1;

    private final ProblemService problemService;

    @GetMapping("/problem-versions/{problemVersionId}/test-cases")
    public InternalTestCasesResponse getTestCases(@PathVariable Long problemVersionId) {

        List<TestCase> testCases = problemService.getTestCasesForVersion(problemVersionId);

        List<InternalTestCaseDTO> dtos = testCases.stream()
                .map(tc -> InternalTestCaseDTO.builder()
                        .id(String.valueOf(tc.getId()))
                        .ordinal(tc.getOrdinal() != null ? tc.getOrdinal() : 0)
                        .isSample(tc.isSample())
                        .inputS3Key(tc.getInputS3Key())
                        .expectedS3Key(tc.getExpectedS3Key())
                        .weight(tc.getWeight() != null ? tc.getWeight() : DEFAULT_WEIGHT)
                        .build())
                .toList();

        return InternalTestCasesResponse.builder().testCases(dtos).build();
    }

    @GetMapping("/problems/{problemId}/limits")
    public InternalLimitsResponse getLimits(@PathVariable Long problemId) {

        Problem problem = problemService.getProblemOrThrow(problemId);

        return InternalLimitsResponse.builder()
                .timeLimitMs(problem.getTimeLimitMs() != null ? problem.getTimeLimitMs() : DEFAULT_TIME_LIMIT_MS)
                .memoryLimitMb(problem.getMemoryLimitMb() != null ? problem.getMemoryLimitMb() : DEFAULT_MEMORY_LIMIT_MB)
                .build();
    }
}
