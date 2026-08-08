package com.MS_code_execution_platform.problem_service.harness;

import com.MS_code_execution_platform.problem_service.dto.FunctionParam;
import com.MS_code_execution_platform.problem_service.dto.FunctionSignature;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Generates the boilerplate appended after a user's `class Solution { ... };`
 * for C++ submissions: an `int main()` that reads JSON from stdin, calls the
 * user's method with typed arguments, and prints the JSON result.
 *
 * The sandbox's execution image is plain g++ with no external libraries
 * (no nlohmann/json etc.), so this also appends a small, hand-written, FIXED
 * JSON reader/writer (namespace __json, see
 * resources/harness-templates/JsonHelper.cpp.txt) restricted to exactly our
 * type vocabulary (int, int[], int[][], string, bool) - mirrors
 * JavaHarnessGenerator's __Json helper.
 *
 * Ordering differs from JavaHarnessGenerator on purpose: Java resolves
 * top-level classes regardless of declaration order, so Main can precede
 * JsonHelper in the file. C++ compiles top-to-bottom in one pass, so the
 * __json helper namespace has to come BEFORE int main() here, or main()'s
 * calls to __json::* would reference not-yet-declared symbols.
 *
 * HarnessApplier (submission-service) is responsible for prepending
 * `#include <bits/stdc++.h>` / `using namespace std;` BEFORE the user's own
 * `class Solution { ... };` - required because the user's method signatures
 * themselves reference vector/string, which must already be declared at
 * that point (see HarnessApplier's PREAMBLES map).
 */
@Component
public class CppHarnessGenerator implements HarnessGenerator {

    private static final Map<String, String> CPP_TYPE = Map.of(
            "int", "int",
            "int[]", "vector<int>",
            "int[][]", "vector<vector<int>>",
            "string", "string",
            "bool", "bool"
    );

    private static final Map<String, String> CAST_METHOD = Map.of(
            "int", "__json::toInt",
            "int[]", "__json::toIntArray",
            "int[][]", "__json::toIntArray2D",
            "string", "__json::toStr",
            "bool", "__json::toBool"
    );

    private final String jsonHelperSource;

    public CppHarnessGenerator() {
        this.jsonHelperSource = readResource("harness-templates/JsonHelper.cpp.txt");
    }

    private static String readResource(String path) {
        try {
            return new ClassPathResource(path).getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("failed to load harness template: " + path, e);
        }
    }

    @Override
    public String language() {
        return "cpp";
    }

    @Override
    public String generate(FunctionSignature sig) {
        for (FunctionParam p : sig.getParams()) {
            TypeVocabulary.requireSupported(p.getType());
        }
        TypeVocabulary.requireSupported(sig.getReturnType());

        String decls = sig.getParams().stream()
                .map(p -> "    %s %s = %s(__json::get(__args, %s));".formatted(
                        CPP_TYPE.get(p.getType()), p.getName(),
                        CAST_METHOD.get(p.getType()), cppStringLiteral(p.getName())))
                .collect(Collectors.joining("\n"));

        String callArgs = sig.getParams().stream()
                .map(FunctionParam::getName)
                .collect(Collectors.joining(", "));

        String mainFunction = """


                int main() {
                    std::ostringstream __ss;
                    __ss << std::cin.rdbuf();
                    std::string __input = __ss.str();
                    __json::Value __args = __json::parse(__input);
                %s
                    %s __result = Solution().%s(%s);
                    std::cout << __json::toJson(__result) << std::endl;
                    return 0;
                }
                """.formatted(decls, CPP_TYPE.get(sig.getReturnType()), sig.getFunctionName(), callArgs);

        return jsonHelperSource + "\n" + mainFunction;
    }

    private static String cppStringLiteral(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
