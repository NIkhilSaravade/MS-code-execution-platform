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
 * Generates the boilerplate appended after a user's `class Solution { ... }`
 * for Java submissions: a `public class Main` (the sandbox's javac/java
 * invocation requires the public class to be named Main - see
 * worker-service's CodeExecutionService) that reads JSON from stdin, calls
 * the user's method with typed arguments, and prints the JSON result.
 *
 * The sandbox's execution image is plain `javac`/`java` with no external
 * jars available (no Jackson/Gson), so this also appends a small,
 * hand-written, FIXED JSON reader/writer (__Json, see
 * resources/harness-templates/JsonHelper.java.txt) restricted to exactly our
 * type vocabulary (int, int[], int[][], string, bool) - not a general
 * parser, just enough grammar for what these signatures ever produce. Kept
 * as a plain resource file rather than an inline Java string literal so it's
 * checkable/editable as real Java source, not an escaped blob.
 */
@Component
public class JavaHarnessGenerator implements HarnessGenerator {

    private static final Map<String, String> JAVA_TYPE = Map.of(
            "int", "int",
            "int[]", "int[]",
            "int[][]", "int[][]",
            "string", "String",
            "bool", "boolean"
    );

    private static final Map<String, String> CAST_METHOD = Map.of(
            "int", "__Json.toInt",
            "int[]", "__Json.toIntArray",
            "int[][]", "__Json.toIntArray2D",
            "string", "__Json.toStr",
            "bool", "__Json.toBool"
    );

    private final String jsonHelperSource;

    public JavaHarnessGenerator() {
        this.jsonHelperSource = readResource("harness-templates/JsonHelper.java.txt");
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
        return "java";
    }

    @Override
    public String generate(FunctionSignature sig) {
        for (FunctionParam p : sig.getParams()) {
            TypeVocabulary.requireSupported(p.getType());
        }
        TypeVocabulary.requireSupported(sig.getReturnType());

        String decls = sig.getParams().stream()
                .map(p -> "        %s %s = %s(__args.get(%s));".formatted(
                        JAVA_TYPE.get(p.getType()), p.getName(),
                        CAST_METHOD.get(p.getType()), javaStringLiteral(p.getName())))
                .collect(Collectors.joining("\n"));

        String callArgs = sig.getParams().stream()
                .map(FunctionParam::getName)
                .collect(Collectors.joining(", "));

        String mainClass = """


                public class Main {
                    @SuppressWarnings("unchecked")
                    public static void main(String[] args) throws Exception {
                        String __input = new String(System.in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                        java.util.Map<String, Object> __args = (java.util.Map<String, Object>) __Json.parse(__input);
                %s
                        %s __result = new Solution().%s(%s);
                        System.out.println(__Json.toJson(__result));
                    }
                }
                """.formatted(decls, JAVA_TYPE.get(sig.getReturnType()), sig.getFunctionName(), callArgs);

        return mainClass + "\n" + jsonHelperSource;
    }

    private static String javaStringLiteral(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
