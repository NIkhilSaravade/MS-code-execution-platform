package com.MS_code_execution_platform.submission_service.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

@Data
public class InternalLimitsResponse {

    @JsonProperty("time_limit_ms")
    private int timeLimitMs;

    @JsonProperty("memory_limit_mb")
    private int memoryLimitMb;
}
