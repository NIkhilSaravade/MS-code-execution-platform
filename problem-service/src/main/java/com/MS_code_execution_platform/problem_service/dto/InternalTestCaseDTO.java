package com.MS_code_execution_platform.problem_service.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class InternalTestCaseDTO {

    private String id;
    private int ordinal;

    @JsonProperty("is_sample")
    private boolean isSample;

    @JsonProperty("input_s3_key")
    private String inputS3Key;

    @JsonProperty("expected_s3_key")
    private String expectedS3Key;

    private int weight;
}
