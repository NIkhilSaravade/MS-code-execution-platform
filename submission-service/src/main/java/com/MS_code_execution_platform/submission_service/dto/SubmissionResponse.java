package com.MS_code_execution_platform.submission_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.UUID;

@Data
@AllArgsConstructor
public class SubmissionResponse {
    private UUID submissionId;
    private String status;
}
