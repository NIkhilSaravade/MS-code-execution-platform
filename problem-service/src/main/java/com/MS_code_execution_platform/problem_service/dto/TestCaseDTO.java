package com.MS_code_execution_platform.problem_service.dto;

import lombok.Data;

@Data
public class TestCaseDTO {

    private String input;
    private String expectedOutput;
    private boolean hidden;
}