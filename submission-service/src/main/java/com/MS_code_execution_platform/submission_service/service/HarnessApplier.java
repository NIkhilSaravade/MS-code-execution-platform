package com.MS_code_execution_platform.submission_service.service;

import com.MS_code_execution_platform.submission_service.client.ProblemServiceClient;
import com.MS_code_execution_platform.submission_service.dto.ProblemDetails;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Glues a problem's generated harness (see problem-service's harness
 * package) after the user's submitted code, so what actually gets judged is
 * one complete runnable program - see the "LeetCode stub vs raw script"
 * design discussion this implements.
 *
 * Falls back to the user's code UNCHANGED when the problem has no harness
 * for the submitted language (either the problem was never given a
 * signature, or that language's generator wasn't registered when the
 * problem's harness was last (re)generated - see problem-service's
 * POST /problems/{id}/harness/regenerate) - those submissions keep being
 * judged as a raw stdin/stdout script, exactly as before harnesses existed.
 */
@Component
@RequiredArgsConstructor
public class HarnessApplier {

    // Some languages need boilerplate to precede the user's code rather than
    // follow it (Java needs common collection imports before any type
    // declaration; C++'s harness-generated types like vector/string need to
    // be #included before the user's class references them in its method
    // signatures). Languages absent here need no preamble - Python's harness
    // is only ever appended after.
    private static final Map<String, String> PREAMBLES = Map.of(
            "java", "import java.util.*;\n\n",
            "cpp", "#include <bits/stdc++.h>\nusing namespace std;\n\n",
            "c", "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n"
                    + "#include <stdbool.h>\n#include <ctype.h>\n\n",
            "go", "package main\n\nimport (\n\t\"encoding/json\"\n\t\"fmt\"\n\t\"io\"\n\t\"os\"\n)\n\n"
    );

    private final ProblemServiceClient problemServiceClient;

    public String apply(Long problemId, String language, String userCode) {
        ProblemDetails problem = problemServiceClient.getProblem(problemId);
        String lang = language == null ? "" : language.toLowerCase();

        String harness = problem.getHarnessByLanguage() == null
                ? null
                : problem.getHarnessByLanguage().get(lang);
        if (harness == null || harness.isBlank()) {
            return userCode;
        }

        String preamble = PREAMBLES.getOrDefault(lang, "");
        return preamble + userCode + "\n\n" + harness;
    }
}
