package com.MS_code_execution_service.execution_result_service.dto;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;

@Data
@Builder
public class ExecutionResultResponse {
    private Long submissionId;
    private String status;
    private String output;
    private Instant createdAt;
}
