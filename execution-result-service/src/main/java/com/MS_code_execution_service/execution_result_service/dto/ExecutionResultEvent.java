package com.MS_code_execution_service.execution_result_service.dto;

import lombok.Data;

@Data
public class ExecutionResultEvent {
    private Long submissionId;
    private Long problemId;
    private Long userId;
    private String output;
    private Long executionTime;
}