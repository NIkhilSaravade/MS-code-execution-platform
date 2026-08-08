package com.MS_code_execution_platform.problem_service.harness;

import com.MS_code_execution_platform.problem_service.dto.FunctionSignature;
import org.springframework.stereotype.Component;

/**
 * See JsFamilyHarness - JavaScript and TypeScript generate byte-identical
 * boilerplate (both run on Node, both have JSON built in; JSON.parse's
 * `any` result flows into the user's typed parameters without a compile
 * error, so the appended code needs no type annotations). This is a thin
 * wrapper that only supplies the language id.
 */
@Component
public class TypeScriptHarnessGenerator implements HarnessGenerator {

    @Override
    public String language() {
        return "typescript";
    }

    @Override
    public String generate(FunctionSignature sig) {
        return JsFamilyHarness.generate(sig, true);
    }
}
