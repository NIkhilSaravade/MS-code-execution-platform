package com.MS_code_execution_platform.problem_service.harness;

import com.MS_code_execution_platform.problem_service.dto.FunctionSignature;
import org.springframework.stereotype.Component;

/**
 * See JsFamilyHarness - JavaScript and TypeScript generate byte-identical
 * boilerplate (both run on Node, both have JSON built in), so this is a
 * thin wrapper that only supplies the language id.
 */
@Component
public class JavaScriptHarnessGenerator implements HarnessGenerator {

    @Override
    public String language() {
        return "javascript";
    }

    @Override
    public String generate(FunctionSignature sig) {
        return JsFamilyHarness.generate(sig, false);
    }
}
