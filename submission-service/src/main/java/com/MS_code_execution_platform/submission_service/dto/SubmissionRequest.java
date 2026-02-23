package com.MS_code_execution_platform.submission_service.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.UUID;

@Data
public class SubmissionRequest {

    private UUID userId;
    private Long problemId;
    private String code;
    private String language;
}
