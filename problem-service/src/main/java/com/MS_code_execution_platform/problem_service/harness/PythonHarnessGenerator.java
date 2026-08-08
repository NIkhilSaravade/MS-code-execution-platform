package com.MS_code_execution_platform.problem_service.harness;

import com.MS_code_execution_platform.problem_service.dto.FunctionSignature;
import org.springframework.stereotype.Component;

import java.util.stream.Collectors;

/**
 * Generates the boilerplate appended after a user's `class Solution:` for
 * Python submissions. Python needs no per-type casting - json.loads() already
 * produces native list/int/str/bool values matching our type vocabulary, so
 * the template only needs the function name and parameter NAMES (in order),
 * not their types.
 */
@Component
public class PythonHarnessGenerator {

    public String generate(FunctionSignature sig) {
        sig.getParams().forEach(p -> TypeVocabulary.requireSupported(p.getType()));

        String args = sig.getParams().stream()
                .map(p -> "__args[" + pyStringLiteral(p.getName()) + "]")
                .collect(Collectors.joining(", "));

        return """


                if __name__ == "__main__":
                    import json, sys
                    __args = json.loads(sys.stdin.read())
                    __result = Solution().%s(%s)
                    print(json.dumps(__result, separators=(",", ":")))
                """.formatted(sig.getFunctionName(), args);
    }

    private static String pyStringLiteral(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
