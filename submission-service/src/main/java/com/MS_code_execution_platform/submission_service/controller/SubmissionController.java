package com.MS_code_execution_platform.submission_service.controller;

import com.MS_code_execution_platform.submission_service.dto.SubmissionRequest;
import com.MS_code_execution_platform.submission_service.dto.SubmissionResponse;
import com.MS_code_execution_platform.submission_service.entity.Submission;
import com.MS_code_execution_platform.submission_service.repository.SubmissionRepository;
import com.MS_code_execution_platform.submission_service.service.SubmissionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/submissions")
@RequiredArgsConstructor
public class SubmissionController {

    private final SubmissionService submissionService;
    private final SubmissionRepository submissionRepository;

    @PostMapping
    public SubmissionResponse submit(@RequestBody SubmissionRequest request) {
        return submissionService.createSubmission(request);
    }

    // Object-level authz (query scoping): load by id AND caller, never by id
    // alone. A submission that isn't the caller's simply isn't found - "not
    // found" rather than "forbidden" so the response doesn't confirm to an
    // attacker whether the id even exists.
    @GetMapping("/{id}")
    public Submission getSubmission(@PathVariable Long id, @AuthenticationPrincipal Jwt jwt) {
        UUID callerId = UUID.fromString(jwt.getSubject());
        return submissionRepository.findByIdAndUserId(id, callerId)
                .orElseThrow(() -> new AccessDeniedException("Submission not found"));
    }

    // Same idea for the list endpoint: the path still takes a userId (kept
    // for API compatibility), but it's only ever honored when it matches the
    // caller's own id - otherwise user A could read user B's submission list
    // just by changing the path.
    @GetMapping("/user/{userId}")
    public List<Submission> getUserSubmissions(@PathVariable UUID userId, @AuthenticationPrincipal Jwt jwt) {
        UUID callerId = UUID.fromString(jwt.getSubject());
        if (!callerId.equals(userId)) {
            throw new AccessDeniedException("Cannot view another user's submissions");
        }
        return submissionRepository.findByUserId(userId);
    }
}