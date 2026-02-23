package com.MS_code_execution_service.execution_result_service.controller;

import com.MS_code_execution_service.execution_result_service.entity.ExecutionResult;
import com.MS_code_execution_service.execution_result_service.repository.ExecutionResultRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/results")
@RequiredArgsConstructor
public class ExecutionResultController {

    private final ExecutionResultRepository repository;

    @GetMapping("/{id}")
    public ExecutionResult getResult(@PathVariable Long id) {
        return repository.findById(id)
                .orElseThrow(() -> new RuntimeException("Result not found"));
    }
}
