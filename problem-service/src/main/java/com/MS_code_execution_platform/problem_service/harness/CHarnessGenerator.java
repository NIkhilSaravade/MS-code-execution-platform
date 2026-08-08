package com.MS_code_execution_platform.problem_service.harness;

import com.MS_code_execution_platform.problem_service.dto.FunctionParam;
import com.MS_code_execution_platform.problem_service.dto.FunctionSignature;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Generates the boilerplate appended after a user's plain C function for C
 * submissions: an `int main(void)` that reads JSON from stdin, calls the
 * user's function, and prints the JSON result.
 *
 * Unlike the other generators, this one does NOT just fill in a fixed set of
 * per-param decl/call-arg strings from TypeVocabulary - C has no arrays with
 * a built-in length, no strings-with-length, no generics, so a real C
 * LeetCode-style function signature carries extra "companion" parameters the
 * generic type mapping alone can't express:
 *   - an int[] PARAMETER becomes (int* name, int nameSize)
 *   - an int[][] PARAMETER becomes (int** name, int nameSize, int* nameColSize)
 *   - an int[] RETURN adds a trailing (..., int* returnSize) out-param, and
 *     the function is expected to return a malloc'd int*
 *   - an int[][] RETURN adds trailing (..., int* returnSize,
 *     int** returnColumnSizes) out-params
 * This mirrors real LeetCode's actual C problem templates (see e.g. Two
 * Sum's `int* twoSum(int* nums, int numsSize, int target, int* returnSize)`)
 * rather than inventing a custom struct-based vocabulary - the frontend's
 * starter code for C problems must match this exact convention.
 *
 * No JSON library exists in the plain gcc sandbox image, so this also
 * appends a small, hand-written, FIXED JSON reader/writer (see
 * resources/harness-templates/JsonHelper.c.txt) restricted to exactly our
 * type vocabulary (int, int[], int[][], string, bool) - mirrors
 * JavaHarnessGenerator's/CppHarnessGenerator's JSON helpers. As with C++,
 * the helper must be appended BEFORE main() (C compiles top-to-bottom, no
 * forward resolution across the file the way Java has).
 *
 * HarnessApplier (submission-service) is responsible for prepending the
 * standard library #includes (stdio/stdlib/string/stdbool/ctype) before the
 * user's own function - see HarnessApplier's PREAMBLES map.
 */
@Component
public class CHarnessGenerator implements HarnessGenerator {

    private final String jsonHelperSource;

    public CHarnessGenerator() {
        this.jsonHelperSource = readResource("harness-templates/JsonHelper.c.txt");
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
        return "c";
    }

    @Override
    public String generate(FunctionSignature sig) {
        for (FunctionParam p : sig.getParams()) {
            TypeVocabulary.requireSupported(p.getType());
        }
        TypeVocabulary.requireSupported(sig.getReturnType());

        List<String> decls = new ArrayList<>();
        List<String> callArgs = new ArrayList<>();

        for (FunctionParam p : sig.getParams()) {
            String name = p.getName();
            String lit = cStringLiteral(name);
            switch (p.getType()) {
                case "int" -> {
                    decls.add("    int %s = __json_to_int(__json_get(&__args, %s));".formatted(name, lit));
                    callArgs.add(name);
                }
                case "int[]" -> {
                    decls.add("    int %sSize;".formatted(name));
                    decls.add("    int* %s = __json_to_int_array(__json_get(&__args, %s), &%sSize);"
                            .formatted(name, lit, name));
                    callArgs.add(name);
                    callArgs.add(name + "Size");
                }
                case "int[][]" -> {
                    decls.add("    int %sSize;".formatted(name));
                    decls.add("    int* %sColSize;".formatted(name));
                    decls.add("    int** %s = __json_to_int_array2d(__json_get(&__args, %s), &%sSize, &%sColSize);"
                            .formatted(name, lit, name, name));
                    callArgs.add(name);
                    callArgs.add(name + "Size");
                    callArgs.add(name + "ColSize");
                }
                case "string" -> {
                    decls.add("    char* %s = __json_to_str(__json_get(&__args, %s));".formatted(name, lit));
                    callArgs.add(name);
                }
                case "bool" -> {
                    decls.add("    bool %s = __json_to_bool(__json_get(&__args, %s));".formatted(name, lit));
                    callArgs.add(name);
                }
                default -> throw new IllegalArgumentException("Unsupported harness type: " + p.getType());
            }
        }

        String resultDecl;
        String print;
        switch (sig.getReturnType()) {
            case "int" -> {
                resultDecl = "    int __result = %s(%s);".formatted(sig.getFunctionName(), String.join(", ", callArgs));
                print = "    __json_print_int(__result);";
            }
            case "bool" -> {
                resultDecl = "    bool __result = %s(%s);".formatted(sig.getFunctionName(), String.join(", ", callArgs));
                print = "    __json_print_bool(__result);";
            }
            case "string" -> {
                resultDecl = "    char* __result = %s(%s);".formatted(sig.getFunctionName(), String.join(", ", callArgs));
                print = "    __json_print_str(__result);";
            }
            case "int[]" -> {
                callArgs.add("&__returnSize");
                resultDecl = "    int __returnSize;\n    int* __result = %s(%s);"
                        .formatted(sig.getFunctionName(), String.join(", ", callArgs));
                print = "    __json_print_int_array(__result, __returnSize);";
            }
            case "int[][]" -> {
                callArgs.add("&__returnSize");
                callArgs.add("&__returnColSizes");
                resultDecl = "    int __returnSize;\n    int* __returnColSizes;\n    int** __result = %s(%s);"
                        .formatted(sig.getFunctionName(), String.join(", ", callArgs));
                print = "    __json_print_int_array2d(__result, __returnSize, __returnColSizes);";
            }
            default -> throw new IllegalArgumentException("Unsupported harness type: " + sig.getReturnType());
        }

        String mainFunction = """


                int main(void) {
                    char* __input = __read_all_stdin();
                    __json_value __args = __json_parse(__input);
                %s
                %s
                %s
                    return 0;
                }
                """.formatted(String.join("\n", decls), resultDecl, print);

        return jsonHelperSource + "\n" + mainFunction;
    }

    private static String cStringLiteral(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
