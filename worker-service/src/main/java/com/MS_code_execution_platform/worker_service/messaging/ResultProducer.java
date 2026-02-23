package com.MS_code_execution_platform.worker_service.messaging;

import com.MS_code_execution_platform.worker_service.dto.ExecutionResult;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ResultProducer {

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public void sendResult(ExecutionResult result) {
        kafkaTemplate.send("result-topic", result);
    }
}
