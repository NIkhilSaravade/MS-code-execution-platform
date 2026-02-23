package com.MS_code_execution_platform.worker_service.consumer;

import com.MS_code_execution_platform.worker_service.service.CodeExecutionService;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class SubmissionConsumer {

    private final CodeExecutionService codeExecutionService;

    @KafkaListener(topics = "submission-topic", groupId = "worker-group")
    public void consume(String message) {
        codeExecutionService.execute(message);
    }
}