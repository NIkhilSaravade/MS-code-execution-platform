package com.MS_code_execution_platform.worker_service.kafka;

import com.MS_code_execution_platform.worker_service.dto.ExecutionResultEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ExecutionResultProducer {

    private final KafkaTemplate<String, ExecutionResultEvent> kafkaTemplate;

    public void sendExecutionResult(ExecutionResultEvent event) {
        kafkaTemplate.send("execution-result-topic", event);
    }
}
