package com.MS_code_execution_platform.worker_service.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One test case's judged outcome, reported alongside the overall verdict -
 * see ExecutionResultEvent. JSON key names are deliberately aligned with
 * worker-service-go's domain.TestCaseResult (its Go json tags), so the
 * frontend can render either worker's result with one shape, not two.
 * Hidden test cases never carry input/expected/actual - only whether they
 * passed. @JsonInclude NON_NULL matches Go's omitempty (omits rather than
 * nulling those fields for hidden cases).
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class TestCaseResult {
    private int ordinal;
    private boolean passed;
    private boolean hidden;
    private String input;
    @JsonProperty("expected")
    private String expected;
    @JsonProperty("actual")
    private String actual;
}
