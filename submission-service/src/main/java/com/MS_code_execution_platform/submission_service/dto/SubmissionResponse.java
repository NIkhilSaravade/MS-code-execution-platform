package com.MS_code_execution_platform.submission_service.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;

import java.util.UUID;

@Data
@Builder
public class SubmissionResponse {

    private Long submissionId;
    private String status;
}