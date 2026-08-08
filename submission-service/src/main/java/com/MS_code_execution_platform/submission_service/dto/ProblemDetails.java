package com.MS_code_execution_platform.submission_service.dto;

import lombok.Data;

import java.util.Map;

/**
 * Mirrors problem-service's ProblemResponse (only the fields this service
 * actually needs). Null/missing harnessByLanguage means the problem has no
 * function signature, or none for the submitted language - HarnessApplier
 * then leaves the submitted code as-is.
 */
@Data
public class ProblemDetails {
    private Long id;
    private String name;
    private Map<String, String> harnessByLanguage;
}
