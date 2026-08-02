package com.MS_code_execution_platform.problem_service.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class InternalLimitsResponse {

    @JsonProperty("time_limit_ms")
    private int timeLimitMs;

    @JsonProperty("memory_limit_mb")
    private int memoryLimitMb;
}
