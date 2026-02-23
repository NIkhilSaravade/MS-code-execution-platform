package com.MS_code_execution_platform.worker_service.service;

import com.MS_code_execution_platform.worker_service.dto.ExecutionResultEvent;
import com.MS_code_execution_platform.worker_service.dto.ProblemResponse;
import com.MS_code_execution_platform.worker_service.dto.SubmissionEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
@RequiredArgsConstructor
public class WorkerService {

    private final CodeExecutionService codeExecutionService;
    private final RestTemplate restTemplate;
    private final KafkaTemplate<String, ExecutionResultEvent> kafkaTemplate;

    @Value("${problem-service.url}")
    private String problemServiceUrl;

    @Value("${topics.execution-result}")
    private String resultTopic;

    public void processSubmission(SubmissionEvent event) {

        ProblemResponse problem = restTemplate.getForObject(
                problemServiceUrl + "/problems/" + event.getProblemId(),
                ProblemResponse.class
        );

        String actualOutput = codeExecutionService.execute(
                event.getSubmissionId(),
                event.getCode(),
                event.getLanguage()
        );

        String status = actualOutput.trim().equals(problem.getExpectedOutput().trim())
                ? "PASSED" : "FAILED";

        kafkaTemplate.send(resultTopic,
                new ExecutionResultEvent(
                        event.getSubmissionId(),
                        actualOutput,
                        status
                ));
    }
}