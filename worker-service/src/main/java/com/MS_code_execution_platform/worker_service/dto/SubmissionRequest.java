package com.MS_code_execution_platform.worker_service.dto;

import lombok.Data;

import java.util.List;

@Data
public class SubmissionRequest {
    private String submissionId;
    private String language;
    private String code;
    private List<TestCase> testCases;
}