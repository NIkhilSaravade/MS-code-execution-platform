package com.MS_code_execution_platform.problem_service.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class TestCaseResponse {

    private String input;
    private String expectedOutput;
}