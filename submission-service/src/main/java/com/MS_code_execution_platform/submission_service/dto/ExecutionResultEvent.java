package com.MS_code_execution_platform.submission_service.dto;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Data;

@Data
public class ExecutionResultEvent {

    private Long submissionId;
    private String status;
    private String output;

    // See InternalStateUpdateRequest's field of the same name/type - same
    // reasoning (worker-service publishes this as a real JSON array, not a
    // JSON-encoded string).
    private JsonNode testCaseResults;
}