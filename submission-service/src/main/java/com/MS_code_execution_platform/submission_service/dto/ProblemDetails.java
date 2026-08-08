package com.MS_code_execution_platform.submission_service.dto;

import lombok.Data;

/**
 * Mirrors problem-service's ProblemResponse (only the fields this service
 * actually needs). Null harnessPython/harnessJava means the problem has no
 * function signature - HarnessApplier then leaves the submitted code as-is.
 */
@Data
public class ProblemDetails {
    private Long id;
    private String name;
    private String harnessPython;
    private String harnessJava;
}
