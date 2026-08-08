package com.MS_code_execution_platform.worker_service.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class ExecutionResultEvent {

    private Long submissionId;
    private String output;
    private String status; // PASSED / FAILED
    private List<TestCaseResult> testCaseResults;
}