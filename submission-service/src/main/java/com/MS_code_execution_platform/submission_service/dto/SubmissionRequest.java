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

    // true (default via Boolean.TRUE.equals guard in SubmissionService) for
    // a real Submit - judge against every test case, hidden included. false
    // for a Run - judge against only the visible ones, matching LeetCode's
    // "Run Code" (examples only) vs "Submit" (full hidden suite) distinction.
    private Boolean includeHidden;
}
