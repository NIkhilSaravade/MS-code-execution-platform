package com.MS_code_execution_platform.problem_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

// One worked example shown on the Solve page's Description tab (input/
// output/optional explanation) - purely display content, distinct from the
// actual judged test cases (see TestCaseDTO). Reused directly by Problem
// (entity) and ProblemRequest/ProblemResponse, same convention as
// FunctionParam.
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Example {
    private String input;
    private String output;
    private String explanation;
}
