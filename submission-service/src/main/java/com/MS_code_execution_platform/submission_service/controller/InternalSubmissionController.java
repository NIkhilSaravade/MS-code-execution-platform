package com.MS_code_execution_platform.submission_service.controller;

import com.MS_code_execution_platform.submission_service.dto.InternalStateUpdateRequest;
import com.MS_code_execution_platform.submission_service.service.SubmissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * Service-to-service API, not exposed to end users. Callers here authenticate
 * with a service access token (client-credentials grant, ROLE_SERVICE) rather
 * than a user's token - see SecurityConfig's /internal/** rule.
 */
@RestController
@RequestMapping("/internal/submissions")
@RequiredArgsConstructor
public class InternalSubmissionController {

    private final SubmissionService submissionService;

    @PatchMapping("/{id}/state")
    public void updateState(@PathVariable Long id, @RequestBody InternalStateUpdateRequest request) {
        submissionService.updateState(id, request.getState(), request.getReason());
    }
}
