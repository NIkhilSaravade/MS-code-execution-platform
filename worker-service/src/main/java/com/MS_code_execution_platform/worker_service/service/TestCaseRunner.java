package com.MS_code_execution_platform.worker_service.service;


import com.MS_code_execution_platform.worker_service.entity.ExecutionResult;
import com.MS_code_execution_platform.worker_service.entity.TestCase;

import java.util.List;

public class TestCaseRunner {

    public static ExecutionResult runAll(
            List<TestCase> testCases,
            DockerSandboxService sandboxService
    ) {

        ExecutionResult result = new ExecutionResult();
        int passed = 0;

        for (TestCase test : testCases) {

            String output = sandboxService.runSingleTest(test.getInput());

            if (output.trim().equals(test.getExpectedOutput().trim())) {
                passed++;
            } else {
                result.setStatus("FAILED");
                result.setOutput("Wrong Answer on input: " + test.getInput());
                return result;
            }
        }

        result.setStatus("ACCEPTED");
        result.setOutput("Passed " + passed + "/" + testCases.size());
        return result;
    }
}
