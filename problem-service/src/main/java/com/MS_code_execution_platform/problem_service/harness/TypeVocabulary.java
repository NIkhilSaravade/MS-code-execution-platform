package com.MS_code_execution_platform.problem_service.harness;

import java.util.Set;

/**
 * Phase 1's fixed set of types a function signature's params/returnType may
 * use. Deliberately small - covers "compute something from simple values"
 * problems (Two Sum, Maximum Subarray, ...), not class-based problems (LRU
 * Cache) or structure-based ones (trees/linked lists), which would need a
 * different, second harness pattern entirely (see the design discussion this
 * package implements).
 */
public final class TypeVocabulary {

    public static final Set<String> SUPPORTED = Set.of(
            "int", "int[]", "int[][]", "string", "bool"
    );

    private TypeVocabulary() {}

    public static void requireSupported(String type) {
        if (!SUPPORTED.contains(type)) {
            throw new IllegalArgumentException(
                    "Unsupported harness type: " + type + " (supported: " + SUPPORTED + ")");
        }
    }
}
