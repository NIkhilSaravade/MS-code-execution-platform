package com.MS_code_execution_platform.submission_service.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class SubmissionRequest {
    @NotBlank
    private String problemId;

    @NotBlank
    private String language;

    @NotBlank
    private String sourceCode;
}
