package com.MS_code_execution_platform.submission_service.dto;

import lombok.Data;

/**
 * Consumed from submission-update-topic, published by execution-result-service
 * once it has persisted a judged result. Deliberately minimal - just enough
 * to flip this service's own Submission.status; the full result detail lives
 * only in execution-result-service (GET /api/results/{submissionId}).
 */
@Data
public class SubmissionUpdateEvent {
    private Long submissionId;
    private String status;
}
