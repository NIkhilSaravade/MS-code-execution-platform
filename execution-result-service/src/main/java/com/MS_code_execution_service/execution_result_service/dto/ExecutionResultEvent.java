package com.MS_code_execution_service.execution_result_service.dto;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Consumed from execution-result-topic - the single ingestion point for
 * judged results from either worker (see worker-service-go's
 * domain.ExecutionResultEvent and worker-service's own copy of this shape).
 * submissionId/userId/problemId are JSON strings on both producer sides.
 *
 * wallTimeMs/maxMemoryKb/estimatedTimeComplexity/estimatedSpaceComplexity
 * are only ever populated by worker-service-go - the legacy worker-service
 * leaves them absent (null), which is expected and handled gracefully.
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
