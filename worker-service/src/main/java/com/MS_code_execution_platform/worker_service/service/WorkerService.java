package com.MS_code_execution_platform.worker_service.service;

import com.MS_code_execution_platform.worker_service.dto.ExecutionResultEvent;
import com.MS_code_execution_platform.worker_service.dto.SubmissionEvent;
import com.MS_code_execution_platform.worker_service.dto.TestCaseResponse;
import com.MS_code_execution_platform.worker_service.dto.TestCaseResult;
import com.MS_code_execution_platform.worker_service.kafka.ExecutionResultProducer;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

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

        // Run (includeHidden=false) only judges the visible/sample cases -
        // matching LeetCode's "Run Code" vs "Submit" distinction.
        if (!event.isIncludeHidden()) {
            testCases = Arrays.stream(testCases)
                    .filter(tc -> !tc.isHidden())
                    .toArray(TestCaseResponse[]::new);
        }

        boolean allPassed = true;
        String lastOutput = "";
        List<TestCaseResult> results = new ArrayList<>();

        for (int ordinal = 0; ordinal < testCases.length; ordinal++) {
            TestCaseResponse testCase = testCases[ordinal];

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

            boolean passed = normalizedActual.equals(normalizedExpected);

            // Never expose a hidden test case's content past this worker -
            // only whether it passed (see dto.TestCaseResult's comment).
            TestCaseResult.TestCaseResultBuilder result = TestCaseResult.builder()
                    .ordinal(ordinal)
                    .passed(passed)
                    .hidden(testCase.isHidden());
            if (!testCase.isHidden()) {
                result.input(testCase.getInput())
                        .expected(testCase.getExpectedOutput())
                        .actual(actualOutput);
            }
            results.add(result.build());

            // Every test case runs regardless of earlier failures - the user
            // wants to see ALL of them judged, not just up to the first miss
            // (unlike most competitive programming judges' default).
            if (!passed) {
                allPassed = false;
            }
        }

        String status = allPassed ? "PASSED" : "FAILED";

        ExecutionResultEvent resultEvent = ExecutionResultEvent.builder()
                .submissionId(String.valueOf(event.getSubmissionId()))
                .userId(String.valueOf(event.getUserId()))
                .problemId(String.valueOf(event.getProblemId()))
                .output(lastOutput)
                .status(status)
                .testCaseResults(results)
                .build();

        executionResultProducer.sendExecutionResult(resultEvent);
    }
}