package com.MS_code_execution_service.execution_result_service.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ExecutionResult {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long submissionId;
    private Long problemId;

    // A UUID string (submission.userId), not a numeric id - the original
    // "bigint" column here was a bug, never actually populated (see
    // ExecutionResultService, which never set it).
    private String userId;

    @Column(columnDefinition = "TEXT")
    private String output;

    private String status;  // PASSED / FAILED / TLE / MLE / RE / CE / SYSTEM_ERROR

    private String reason;

    // JSON array of per-test-case results (see dto.ExecutionResultEvent),
    // stored as-is from either worker's own shape.
    @Column(columnDefinition = "TEXT")
    @com.fasterxml.jackson.annotation.JsonRawValue
    private String testCaseResults;

    private Long wallTimeMs;
    private Long maxMemoryKb;

    // Empirical, worker-computed estimate (see worker-service-go's
    // internal/complexity) - only ever populated when the Go worker judged
    // this submission. Distinct from ai-analysis-service's separate,
    // LLM-derived complexity guess (not stored here).
    private String estimatedTimeComplexity;
    private String estimatedSpaceComplexity;
}
