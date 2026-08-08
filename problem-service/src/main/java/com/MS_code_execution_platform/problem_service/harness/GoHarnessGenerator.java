package com.MS_code_execution_platform.problem_service.harness;

import com.MS_code_execution_platform.problem_service.dto.FunctionParam;
import com.MS_code_execution_platform.problem_service.dto.FunctionSignature;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.stream.Collectors;

/**
 * Generates the boilerplate appended after a user's plain Go function for
 * Go submissions: a `func main()` that reads JSON from stdin, calls the
 * user's function, and prints the JSON result.
 *
 * Unlike C/C++/Java, no hand-rolled JSON helper is needed at all - Go's
 * encoding/json stdlib package handles both directions natively. Rather
 * than a generic Map-based parse (like Python/JS need for lack of static
 * types), this generates an anonymous struct whose fields exactly match the
 * signature's params, each tagged with the JSON key it should bind to:
 * `json.Unmarshal` populates it directly, and the function's return value -
 * whatever its type - can be handed straight to `json.Marshal` with no
 * per-type serialization logic needed (a []int or [][]int slice marshals to
 * a JSON array on its own, no out-param/size bookkeeping like C needs).
 *
 * HarnessApplier (submission-service) is responsible for prepending
 * `package main` and the harness's required imports before the user's own
 * function - required because Go only allows import declarations before
 * ANY other top-level declaration in the file (unlike Java, where imports
 * can effectively appear anywhere before use in practice since this
 * platform prepends them; Go enforces the ordering at the language level).
 * See HarnessApplier's PREAMBLES map. The user's own code may add its own
 * `import (...)` block immediately after the preamble's, if a problem needs
 * a stdlib package beyond what the harness itself requires - Go permits
 * multiple import declarations as long as they all precede the first
 * non-import declaration.
 */
@Component
public class GoHarnessGenerator implements HarnessGenerator {

    private static final Map<String, String> GO_TYPE = Map.of(
            "int", "int",
            "int[]", "[]int",
            "int[][]", "[][]int",
            "string", "string",
            "bool", "bool"
    );

    @Override
    public String language() {
        return "go";
    }

    @Override
    public String generate(FunctionSignature sig) {
        for (FunctionParam p : sig.getParams()) {
            TypeVocabulary.requireSupported(p.getType());
        }
        TypeVocabulary.requireSupported(sig.getReturnType());

        String structFields = sig.getParams().stream()
                .map(p -> "        %s %s `json:%s`".formatted(
                        capitalize(p.getName()), GO_TYPE.get(p.getType()), goStringLiteral(p.getName())))
                .collect(Collectors.joining("\n"));

        String callArgs = sig.getParams().stream()
                .map(p -> "__args." + capitalize(p.getName()))
                .collect(Collectors.joining(", "));

        return """


                func main() {
                    __inputBytes, _ := io.ReadAll(os.Stdin)
                    var __args struct {
                %s
                    }
                    json.Unmarshal(__inputBytes, &__args)
                    __result := %s(%s)
                    __output, _ := json.Marshal(__result)
                    fmt.Println(string(__output))
                }
                """.formatted(structFields, sig.getFunctionName(), callArgs);
    }

    private static String capitalize(String s) {
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    private static String goStringLiteral(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
