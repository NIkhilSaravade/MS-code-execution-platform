package com.MS_code_execution_platform.submission_service.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * Mirrors problem-service's InternalTestCaseDTO - embedded into
 * SubmissionCreatedEvent so worker-service-go never has to call
 * problem-service itself. Field names/JSON keys must match
 * worker-service-go/internal/domain's test case struct exactly.
 */
@Data
public class InternalTestCaseDTO {

    private String id;
    private int ordinal;

    @JsonProperty("is_sample")
    private boolean isSample;

    @JsonProperty("input_s3_key")
    private String inputS3Key;

    @JsonProperty("expected_s3_key")
    private String expectedS3Key;

    private int weight;
}
