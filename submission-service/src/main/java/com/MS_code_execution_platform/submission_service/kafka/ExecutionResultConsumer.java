package com.MS_code_execution_platform.submission_service.kafka;

import com.MS_code_execution_platform.submission_service.dto.ExecutionResultEvent;
import com.MS_code_execution_platform.submission_service.service.SubmissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ExecutionResultConsumer {

    private final SubmissionService submissionService;

    @KafkaListener(topics = "execution-result-topic", groupId = "submission-group")
    public void consumeExecutionResult(ExecutionResultEvent event) {
        submissionService.updateSubmissionResult(event);
    }
}