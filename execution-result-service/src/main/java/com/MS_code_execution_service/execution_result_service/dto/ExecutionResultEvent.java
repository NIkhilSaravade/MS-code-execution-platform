package com.MS_code_execution_service.execution_result_service.dto;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Consumed from execution-result-topic - the single ingestion point for
 * judged results (see worker-service-go's domain.ExecutionResultEvent).
 * submissionId/userId/problemId are JSON strings on the producer side.
 *
 * wallTimeMs/maxMemoryKb/estimatedTimeComplexity/estimatedSpaceComplexity
 * are populated by worker-service-go's static/empirical estimates.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ExecutionResultEvent {

    private String submissionId;
    private String userId;
    private String problemId;
    private String output;
    private String status;
    private String reason;
    private JsonNode testCaseResults;
    private Long wallTimeMs;
    private Long maxMemoryKb;
    private String estimatedTimeComplexity;
    private String estimatedSpaceComplexity;
}
