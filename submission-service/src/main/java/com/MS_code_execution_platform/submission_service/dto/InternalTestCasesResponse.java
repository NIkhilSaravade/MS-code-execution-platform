package com.MS_code_execution_platform.submission_service.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.List;

@Data
public class InternalTestCasesResponse {

    @JsonProperty("test_cases")
    private List<InternalTestCaseDTO> testCases;
}
