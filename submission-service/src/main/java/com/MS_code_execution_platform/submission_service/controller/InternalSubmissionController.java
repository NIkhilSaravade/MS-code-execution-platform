package com.MS_code_execution_platform.submission_service.controller;

import com.MS_code_execution_platform.submission_service.dto.InternalSubmissionResponse;
import com.MS_code_execution_platform.submission_service.entity.Submission;
import com.MS_code_execution_platform.submission_service.repository.SubmissionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.NoSuchElementException;

/**
 * Service-to-service API, not exposed to end users. Callers here authenticate
 * with a service access token (client-credentials grant, ROLE_SERVICE) rather
 * than a user's token - see SecurityConfig's /internal/** rule.
 *
 * Unlike GET /submissions/{id}, this is NOT scoped by an end-user JWT subject
 * - it exists for ai-analysis-service's Kafka-triggered analysis path (see
 * analysis.trigger.v1), which has no end-user token to forward.
 */
@RestController
@RequestMapping("/internal/submissions")
@RequiredArgsConstructor
public class InternalSubmissionController {

    private final SubmissionRepository submissionRepository;

    @GetMapping("/{id}")
    public InternalSubmissionResponse getSubmission(@PathVariable Long id) {
        Submission submission = submissionRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Submission not found: " + id));

        return InternalSubmissionResponse.builder()
                .submissionId(submission.getId())
                .userId(submission.getUserId())
                .problemId(submission.getProblemId())
                .code(submission.getCode())
                .language(submission.getLanguage())
                .status(submission.getStatus())
                .build();
    }
}
