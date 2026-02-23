package com.MS_code_execution_platform.worker_service.entity;

import lombok.Data;

@Data
public class ExecutionResult {

    private String submissionId;
    private String status;
    private String output;
    private String error;
    private long executionTime;
}