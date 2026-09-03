package com.MS_code_execution_platform.problem_service.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.List;

@Data
public class ProblemRequest {

    // Was silently nullable before - a request that used the wrong field
    // name (e.g. "title" instead of "name") would 200 with a null name
    // persisted, which then crashed the frontend's practice list (calling
    // .toLowerCase() on it) for every user, not just fail loudly for the
    // caller who made the mistake.
    @NotBlank
    private String name;
    private String description;
    private String constraints;
    private String difficulty;
    private List<String> tags;
    private List<Example> examples;
    private Integer timeLimitMs;
    private Integer memoryLimitMb;
    private List<TestCaseDTO> testCases;

    // Optional - see FunctionSignature. When present, ProblemService
    // generates and stores Python/Java harness boilerplate at creation time.
    private FunctionSignature signature;
}