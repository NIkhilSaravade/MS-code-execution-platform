package com.MS_code_execution_platform.worker_service.dto;

import lombok.Data;

import java.util.List;
@Data
public class ProblemResponse {
    private Long id;
    private String title;
    private String expectedOutput;
}