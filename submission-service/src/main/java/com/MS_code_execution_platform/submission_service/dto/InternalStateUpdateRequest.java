package com.MS_code_execution_platform.submission_service.dto;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Data;

@Data
public class InternalStateUpdateRequest {

    private String state;
    private String reason;
    private String output;

    // JsonNode (Jackson's generic tree type), not String: worker-service-go
    // sends this as a real JSON array in the request body, not a
    // JSON-encoded string - JsonNode accepts either shape without a type
    // mismatch, and .toString() gives back the raw JSON text to store as-is.
    private JsonNode testCaseResults;
}
