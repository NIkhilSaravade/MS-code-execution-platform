package com.MS_code_execution_platform.problem_service.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class InternalTestCasesResponse {

    @JsonProperty("test_cases")
    private List<InternalTestCaseDTO> testCases;
}
