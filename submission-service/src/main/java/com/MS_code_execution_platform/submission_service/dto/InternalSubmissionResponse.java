package com.MS_code_execution_platform.submission_service.dto;

import lombok.Builder;
import lombok.Data;

import java.util.UUID;

/**
 * Service-to-service read of a submission's lifecycle fields, with no
 * ownership check (unlike GET /submissions/{id}) - used by ai-analysis-service
 * when it's triggered by the analysis.trigger.v1 Kafka event, where there is
 * no end-user JWT to scope the lookup by.
 */
@Data
@Builder
public class InternalSubmissionResponse {
    private Long submissionId;
    private UUID userId;
    private Long problemId;
    private String code;
    private String language;
    private String status;
}
