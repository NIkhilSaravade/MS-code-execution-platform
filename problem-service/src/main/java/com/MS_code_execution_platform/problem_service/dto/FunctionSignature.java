package com.MS_code_execution_platform.problem_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Admin-authored, language-agnostic description of the function a solution
 * must implement (e.g. "twoSum(nums: int[], target: int) -> int[]"). The
 * harness package turns this into real Python/Java boilerplate once, at
 * problem-creation time - see ProblemService.createProblem.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class FunctionSignature {
    private String functionName;
    private List<FunctionParam> params;
    private String returnType;
}
