package com.MS_code_execution_platform.problem_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One parameter of a problem's function signature (see harness package).
 * `type` is one of the fixed Phase 1 vocabulary: int, int[], int[][],
 * string, bool - see harness.TypeVocabulary.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class FunctionParam {
    private String name;
    private String type;
}
