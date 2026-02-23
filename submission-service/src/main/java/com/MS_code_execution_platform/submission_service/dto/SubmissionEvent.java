package com.MS_code_execution_platform.submission_service.dto;

import java.util.UUID;

public record SubmissionEvent(
        Long submissionId,
        UUID userId,
        Long problemId,
        String code,
        String language
) {}