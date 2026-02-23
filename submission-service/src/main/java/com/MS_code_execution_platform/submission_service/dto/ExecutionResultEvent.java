package com.MS_code_execution_platform.submission_service.dto;

import lombok.Data;

@Data
public class ExecutionResultEvent {

    private Long submissionId;
    private String status;
    private String output;
}