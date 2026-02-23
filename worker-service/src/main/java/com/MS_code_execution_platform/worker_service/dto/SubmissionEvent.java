package com.MS_code_execution_platform.worker_service.dto;

import lombok.Data;

@Data
public class SubmissionEvent {

    private Long submissionId;
    private Long problemId;
    private Long userId;
    private String code;
    private String language;
}