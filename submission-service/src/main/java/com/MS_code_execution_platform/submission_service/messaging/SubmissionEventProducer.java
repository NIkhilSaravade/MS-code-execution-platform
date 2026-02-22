package com.MS_code_execution_platform.submission_service.messaging;

import com.MS_code_execution_platform.submission_service.entity.Submission;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class SubmissionEventProducer {

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public void publishSubmissionCreated(Submission submission) {
        kafkaTemplate.send(
                "submission.created",
                submission.getId().toString(),
                submission
        );
    }
}