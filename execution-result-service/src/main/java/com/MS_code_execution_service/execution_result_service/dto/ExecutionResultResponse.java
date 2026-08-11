package com.MS_code_execution_service.execution_result_service.dto;

import com.fasterxml.jackson.annotation.JsonRawValue;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class ExecutionResultResponse {
    private Long submissionId;
    private String status;
    private String output;
    private String reason;

    @JsonRawValue
    private String testCaseResults;

    private Long wallTimeMs;
    private Long maxMemoryKb;
    private String estimatedTimeComplexity;
    private String estimatedSpaceComplexity;
}
