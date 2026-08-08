package com.MS_code_execution_platform.submission_service.service;

import com.MS_code_execution_platform.submission_service.client.ProblemServiceClient;
import com.MS_code_execution_platform.submission_service.dto.ProblemDetails;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Glues a problem's generated harness (see problem-service's harness
 * package) after the user's submitted code, so what actually gets judged is
 * one complete runnable program - see the "LeetCode stub vs raw script"
 * design discussion this implements.
 *
 * Falls back to the user's code UNCHANGED when the problem has no signature
 * for the submitted language (either the problem was never given one, or the
 * language isn't Python/Java) - those submissions keep being judged as a raw
 * stdin/stdout script, exactly as before this existed.
 */
@Component
@RequiredArgsConstructor
public class HarnessApplier {

    // Java needs common collection types (Map, List, ...) available without
    // the user having to write imports themselves - LeetCode's own Java
    // template does the same. Must come BEFORE the user's class (Java
    // requires imports to precede any type declaration), which is why Java
    // and Python are assembled differently below - Python's harness is only
    // ever appended after, since it needs no such prefix.
    private static final String JAVA_IMPORTS = "import java.util.*;\n\n";

    private final ProblemServiceClient problemServiceClient;

    public String apply(Long problemId, String language, String userCode) {
        ProblemDetails problem = problemServiceClient.getProblem(problemId);
        String lang = language == null ? "" : language.toLowerCase();

        if ("python".equals(lang)) {
            String harness = problem.getHarnessPython();
            return (harness == null || harness.isBlank()) ? userCode : userCode + "\n\n" + harness;
        }
        if ("java".equals(lang)) {
            String harness = problem.getHarnessJava();
            return (harness == null || harness.isBlank())
                    ? userCode
                    : JAVA_IMPORTS + userCode + "\n\n" + harness;
        }
        return userCode;
    }
}
