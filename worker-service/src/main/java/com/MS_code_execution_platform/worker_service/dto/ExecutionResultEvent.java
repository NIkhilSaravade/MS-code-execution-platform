package com.MS_code_execution_platform.worker_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class ExecutionResultEvent {

    private Long submissionId;
    private String output;
    private String status; // PASSED / FAILED
}