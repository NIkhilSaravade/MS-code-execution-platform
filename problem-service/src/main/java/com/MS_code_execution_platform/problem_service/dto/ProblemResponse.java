package com.MS_code_execution_platform.problem_service.dto;

import lombok.Builder;
import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
@Builder
public class ProblemResponse {

    private Long id;
    private String name;
    private String description;
    private String constraints;

    // Null when the problem has no function signature (see FunctionSignature/
    // harness package) - submission-service falls back to raw-code judging
    // in that case. functionName/params/returnType are the signature itself
    // (also useful for the frontend to render a matching starter stub);
    // harnessByLanguage (language id -> generated boilerplate text) is the
    // actual generated code, appended after the user's code before it's
    // judged - see harness.HarnessGenerator.
    private String functionName;
    private List<FunctionParam> params;
    private String returnType;
    private Map<String, String> harnessByLanguage;
}