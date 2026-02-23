package com.MS_code_execution_service.execution_result_service.controller;

import com.MS_code_execution_service.execution_result_service.entity.ExecutionResult;
import com.MS_code_execution_service.execution_result_service.repository.ExecutionResultRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/results")
@RequiredArgsConstructor
public class ExecutionResultController {

    private final ExecutionResultRepository repository;

    @GetMapping("/{submissionId}")
    public ExecutionResult getResult(@PathVariable Long submissionId) {
        return repository.findBySubmissionId(submissionId)
                .orElseThrow(() -> new RuntimeException("Result not found for submissionId: " + submissionId));
    }
}