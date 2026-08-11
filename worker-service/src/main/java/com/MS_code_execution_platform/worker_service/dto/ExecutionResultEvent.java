package com.MS_code_execution_platform.worker_service.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Published to execution-result-topic - execution-result-service's single
 * ingestion point, shared with worker-service-go's own (extended) event.
 * submissionId/userId/problemId are JSON strings on both sides (matches
 * worker-service-go's string-typed domain fields) - see
 * worker-service-go/internal/domain/events.go's ExecutionResultEvent.
 *
 * This worker has no timing/memory measurement or complexity estimate (see
 * CLAUDE.md - this legacy worker is intentionally kept unchanged from that
 * redesign), so those fields are simply left absent/null here.
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class ExecutionResultEvent {

    private String submissionId;
    private String userId;
    private String problemId;
    private String output;
    private String status; // PASSED / FAILED
    private List<TestCaseResult> testCaseResults;
}
