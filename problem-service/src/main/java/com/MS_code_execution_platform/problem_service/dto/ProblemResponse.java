package com.MS_code_execution_platform.problem_service.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class ProblemResponse {

    private Long id;
    private String name;
    private String description;
    private String constraints;
}