package com.MS_code_execution_platform.submission_service.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class SubmissionRequest {

    private Long userId;
    private Long problemId;
    private String code;
    private String language;
}
