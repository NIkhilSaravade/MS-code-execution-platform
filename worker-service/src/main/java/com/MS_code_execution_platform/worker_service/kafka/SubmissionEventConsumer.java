package com.MS_code_execution_platform.worker_service.kafka;

import com.MS_code_execution_platform.worker_service.dto.SubmissionEvent;
import com.MS_code_execution_platform.worker_service.service.WorkerService;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class SubmissionEventConsumer {

    private final WorkerService workerService;

    @KafkaListener(topics = "${topics.submission}", groupId = "worker-group")
    public void consume(SubmissionEvent event) {
        workerService.processSubmission(event);
    }
}