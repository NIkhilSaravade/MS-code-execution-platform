package com.MS_code_execution_platform.problem_service.harness;

import com.MS_code_execution_platform.problem_service.dto.FunctionSignature;

/**
 * One implementation per supported language. ProblemService discovers all
 * beans implementing this interface (Spring autowires the full List) and
 * builds a language -> generator map from language() - adding a new
 * language is registering one new @Component, nothing else in
 * ProblemService/Problem/ProblemResponse needs to change.
 */
public interface HarnessGenerator {

    // Must match the submitted-code "language" value used everywhere else
    // (submission-service's HarnessApplier, both workers' language ids) -
    // e.g. "python", "java", "cpp".
    String language();

    String generate(FunctionSignature sig);
}
