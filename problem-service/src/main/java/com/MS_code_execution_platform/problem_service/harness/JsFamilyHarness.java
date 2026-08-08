package com.MS_code_execution_platform.problem_service.harness;

import com.MS_code_execution_platform.problem_service.dto.FunctionSignature;

import java.util.stream.Collectors;

/**
 * Shared boilerplate-generation logic for JavaScript and TypeScript - both
 * run on Node, both have JSON.parse/JSON.stringify built in (no hand-rolled
 * JSON helper needed, unlike C/C++/Java's sandbox images which have no JSON
 * library available), and TypeScript's `any`-typed JSON.parse result flows
 * into the user's typed parameters without a compile error, so the appended
 * call-and-print code needs no type annotations either way.
 * JavaScriptHarnessGenerator/TypeScriptHarnessGenerator are thin wrappers
 * over this that only differ in their language() id.
 *
 * The one genuine difference: TypeScript needs an ambient `declare function
 * require(...)` before using it. tsc has no visibility into Node's global
 * types (`require`, `process`, ...) unless @types/node is resolvable from
 * the file being compiled's own node_modules - which a lone, no-project
 * `tsc solution.ts` invocation never has (see
 * infra/sandbox-images/node-typescript - installing @types/node globally
 * doesn't help either, since global npm packages aren't on tsc's default
 * typeRoots lookup for a project-less compile). A one-line inline `declare`
 * sidesteps needing @types/node at all; it's TS-only syntax, so JavaScript
 * skips it - this is the only place these two languages' output diverges.
 *
 * Also unlike Java/C++/C, no preamble is needed before the user's code
 * (see submission-service's HarnessApplier.PREAMBLES) - a plain top-level
 * `function foo(...) {...}` needs nothing to precede it.
 */
final class JsFamilyHarness {

    private JsFamilyHarness() {}

    static String generate(FunctionSignature sig, boolean typescript) {
        sig.getParams().forEach(p -> TypeVocabulary.requireSupported(p.getType()));
        TypeVocabulary.requireSupported(sig.getReturnType());

        String args = sig.getParams().stream()
                .map(p -> "__args[" + jsStringLiteral(p.getName()) + "]")
                .collect(Collectors.joining(", "));

        String requireDecl = typescript ? "declare function require(id: string): any;\n" : "";

        return """


                %sconst __input = require("fs").readFileSync(0, "utf8");
                const __args = JSON.parse(__input);
                const __result = %s(%s);
                console.log(JSON.stringify(__result));
                """.formatted(requireDecl, sig.getFunctionName(), args);
    }

    private static String jsStringLiteral(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
