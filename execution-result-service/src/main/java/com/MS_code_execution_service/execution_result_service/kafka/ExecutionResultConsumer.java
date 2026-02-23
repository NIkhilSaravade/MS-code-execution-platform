package com.MS_code_execution_service.execution_result_service.kafka;

import com.MS_code_execution_service.execution_result_service.dto.ExecutionResultEvent;
import com.MS_code_execution_service.execution_result_service.service.ExecutionResultService;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ExecutionResultConsumer {

    private final ExecutionResultService executionResultService;

    @KafkaListener(topics = "execution-result-topic")
    public void consume(ExecutionResultEvent event) {
        executionResultService.processExecutionResult(event);
    }
}