package com.MS_code_execution_platform.submission_service.kafka;

import com.MS_code_execution_platform.submission_service.dto.SubmissionUpdateEvent;
import com.MS_code_execution_platform.submission_service.service.SubmissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Single write-back path for a submission's status, replacing the old
 * direct-from-worker paths (Kafka execution-result-topic consumer, and the Go
 * worker's HTTP callback) - see execution-result-service.ExecutionResultService,
 * which is now the only publisher of this event.
 */
@Component
@RequiredArgsConstructor
public class SubmissionUpdateConsumer {

    private final SubmissionService submissionService;

    @KafkaListener(
            topics = "submission-update-topic",
            containerFactory = "submissionUpdateKafkaListenerContainerFactory"
    )
    public void consumeSubmissionUpdate(SubmissionUpdateEvent event) {
        submissionService.updateStatus(event.getSubmissionId(), event.getStatus());
    }
}
