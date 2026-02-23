package com.MS_code_execution_platform.submission_service.controller;

import com.MS_code_execution_platform.submission_service.dto.SubmissionRequest;
import com.MS_code_execution_platform.submission_service.dto.SubmissionResponse;
import com.MS_code_execution_platform.submission_service.entity.Submission;
import com.MS_code_execution_platform.submission_service.repository.SubmissionRepository;
import com.MS_code_execution_platform.submission_service.service.SubmissionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
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

    @GetMapping("/{id}")
    public Submission getSubmission(@PathVariable Long id) {
        return submissionRepository.findById(id).orElseThrow();
    }

    @GetMapping("/user/{userId}")
    public List<Submission> getUserSubmissions(@PathVariable Long userId) {
        return submissionRepository.findByUserId(userId);
    }
}