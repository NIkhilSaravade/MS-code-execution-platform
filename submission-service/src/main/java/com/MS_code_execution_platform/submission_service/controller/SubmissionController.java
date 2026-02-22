package com.MS_code_execution_platform.submission_service.controller;

import com.MS_code_execution_platform.submission_service.dto.SubmissionRequest;
import com.MS_code_execution_platform.submission_service.dto.SubmissionResponse;
import com.MS_code_execution_platform.submission_service.service.SubmissionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/submissions")
@RequiredArgsConstructor
public class SubmissionController {

    private final SubmissionService service;

    @PostMapping
    public SubmissionResponse submit(@RequestBody @Valid SubmissionRequest request) {
        // TEMP: hardcoded userId (JWT comes later)
        UUID userId = UUID.randomUUID();
        return service.createSubmission(request, userId);
    }
}