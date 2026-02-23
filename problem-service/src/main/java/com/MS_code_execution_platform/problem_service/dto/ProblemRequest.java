package com.MS_code_execution_platform.problem_service.dto;

import lombok.Data;

import java.util.List;

@Data
public class ProblemRequest {

    private String name;
    private String description;
    private String constraints;
    private List<TestCaseDTO> testCases;
}