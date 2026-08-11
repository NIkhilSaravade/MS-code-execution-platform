package com.MS_code_execution_service.execution_result_service.controller;

import com.MS_code_execution_service.execution_result_service.dto.ExecutionResultResponse;
import com.MS_code_execution_service.execution_result_service.entity.ExecutionResult;
import com.MS_code_execution_service.execution_result_service.repository.ExecutionResultRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/results")
@RequiredArgsConstructor
public class ExecutionResultController {

    private final ExecutionResultRepository repository;

    // The frontend's source of full judged-result detail (test cases, output,
    // timing, the worker's own complexity estimate) - see SolvePage.tsx's
    // getExecutionResult, polled once GET /submissions/{id}'s status goes
    // terminal. Object-level authz, same pattern as submission-service's
    // GET /submissions/{id}: a result that isn't the caller's own submission
    // simply isn't found, not forbidden.
    @GetMapping("/{submissionId}")
    public ExecutionResultResponse getResult(@PathVariable Long submissionId, @AuthenticationPrincipal Jwt jwt) {
        ExecutionResult result = repository.findBySubmissionId(submissionId)
                .orElseThrow(() -> new RuntimeException("Result not found for submissionId: " + submissionId));

        if (result.getUserId() != null && !result.getUserId().equals(jwt.getSubject())) {
            throw new AccessDeniedException("Result not found for submissionId: " + submissionId);
        }

        return ExecutionResultResponse.builder()
                .submissionId(result.getSubmissionId())
                .status(result.getStatus())
                .output(result.getOutput())
                .reason(result.getReason())
                .testCaseResults(result.getTestCaseResults())
                .wallTimeMs(result.getWallTimeMs())
                .maxMemoryKb(result.getMaxMemoryKb())
                .estimatedTimeComplexity(result.getEstimatedTimeComplexity())
                .estimatedSpaceComplexity(result.getEstimatedSpaceComplexity())
                .build();
    }
}
