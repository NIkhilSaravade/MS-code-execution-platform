package com.MS_code_execution_platform.problem_service.dto;

import lombok.Data;

import java.util.List;

@Data
public class ProblemRequest {

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