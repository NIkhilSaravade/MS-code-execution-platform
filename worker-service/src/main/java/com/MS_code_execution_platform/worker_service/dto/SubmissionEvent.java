package com.MS_code_execution_platform.worker_service.dto;

import lombok.Data;

import java.util.UUID;

@Data
public class SubmissionEvent {

    private Long submissionId;
    private Long problemId;
    private UUID userId;
    private String code;
    private String language;
}