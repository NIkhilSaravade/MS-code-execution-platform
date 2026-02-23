package com.MS_code_execution_service.execution_result_service.service;

import com.MS_code_execution_service.execution_result_service.dto.ExecutionResultEvent;
import com.MS_code_execution_service.execution_result_service.dto.ProblemResponse;
import com.MS_code_execution_service.execution_result_service.dto.SubmissionUpdateEvent;
import com.MS_code_execution_service.execution_result_service.entity.ExecutionResult;
import com.MS_code_execution_service.execution_result_service.feign.ProblemClient;
import com.MS_code_execution_service.execution_result_service.repository.ExecutionResultRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;


@Service
@RequiredArgsConstructor
public class ExecutionResultService {

    private final ExecutionResultRepository repository;
    private final KafkaTemplate<String, SubmissionUpdateEvent> kafkaTemplate;
    private final ProblemClient problemClient;

    public void processExecutionResult(ExecutionResultEvent event) {

        // 🔥 Feign call instead of RestTemplate
        ProblemResponse problem =
                problemClient.getProblemById(event.getProblemId());

        String status = event.getOutput().equals(problem.getExpectedOutput())
                ? "PASSED"
                : "FAILED";

        // Save to DB
        ExecutionResult result = ExecutionResult.builder()
                .submissionId(event.getSubmissionId())
                .problemId(event.getProblemId())
                .userId(event.getUserId())
                .output(event.getOutput())
                .status(status)
                .executionTime(event.getExecutionTime())
                .build();

        repository.save(result);

        // 🔁 Send update to Submission Service
        SubmissionUpdateEvent updateEvent =
                SubmissionUpdateEvent.builder()
                        .submissionId(event.getSubmissionId())
                        .status(status)
                        .build();

        kafkaTemplate.send("submission-update-topic", updateEvent);
    }
}