package com.MS_code_execution_service.execution_result_service.service;

import com.MS_code_execution_service.execution_result_service.dto.ExecutionResultEvent;
import com.MS_code_execution_service.execution_result_service.dto.SubmissionUpdateEvent;
import com.MS_code_execution_service.execution_result_service.entity.ExecutionResult;
import com.MS_code_execution_service.execution_result_service.repository.ExecutionResultRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ExecutionResultService {

    private final ExecutionResultRepository repository;
    private final KafkaTemplate<String, SubmissionUpdateEvent> kafkaTemplate;

    public void processExecutionResult(ExecutionResultEvent event) {

        ExecutionResult result = ExecutionResult.builder()
                .submissionId(event.getSubmissionId())
                .output(event.getOutput())
                .status(event.getStatus())
                .build();

        repository.save(result);

        SubmissionUpdateEvent updateEvent =
                SubmissionUpdateEvent.builder()
                        .submissionId(event.getSubmissionId())
                        .status(event.getStatus())
                        .build();

        kafkaTemplate.send("submission-update-topic", updateEvent);
    }
}