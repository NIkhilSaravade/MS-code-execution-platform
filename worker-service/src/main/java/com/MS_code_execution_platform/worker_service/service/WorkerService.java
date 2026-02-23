package com.MS_code_execution_platform.worker_service.service;

import com.MS_code_execution_platform.worker_service.dto.ExecutionResultEvent;
import com.MS_code_execution_platform.worker_service.dto.SubmissionEvent;
import com.MS_code_execution_platform.worker_service.dto.TestCaseResponse;
import com.MS_code_execution_platform.worker_service.kafka.ExecutionResultProducer;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
@RequiredArgsConstructor
public class WorkerService {

    private final CodeExecutionService codeExecutionService;
    private final RestTemplate restTemplate;
    private final ExecutionResultProducer executionResultProducer;

    @Value("${problem-service.url}")
    private String problemServiceUrl;

    public void processSubmission(SubmissionEvent event) {

        TestCaseResponse[] testCases = restTemplate.getForObject(
                problemServiceUrl + "/problems/" + event.getProblemId() + "/testcases",
                TestCaseResponse[].class
        );

        if (testCases == null || testCases.length == 0) {
            throw new RuntimeException("No test cases found for problem: " + event.getProblemId());
        }

        boolean allPassed = true;
        String lastOutput = "";

        for (TestCaseResponse testCase : testCases) {

            // 🔥 PASS test case input to execution service
            String actualOutput = codeExecutionService.execute(
                    event.getSubmissionId(),
                    event.getCode(),
                    event.getLanguage(),
                    testCase.getInput()
            );

            lastOutput = actualOutput;

            String normalizedActual = actualOutput == null
                    ? ""
                    : actualOutput.trim().replaceAll("\\s+", "");

            String normalizedExpected = testCase.getExpectedOutput() == null
                    ? ""
                    : testCase.getExpectedOutput().trim().replaceAll("\\s+", "");

            if (!normalizedActual.equals(normalizedExpected)) {
                allPassed = false;
                break;
            }
        }

        String status = allPassed ? "PASSED" : "FAILED";

        ExecutionResultEvent resultEvent =
                new ExecutionResultEvent(
                        event.getSubmissionId(),
                        lastOutput,
                        status
                );

        executionResultProducer.sendExecutionResult(resultEvent);
    }
}