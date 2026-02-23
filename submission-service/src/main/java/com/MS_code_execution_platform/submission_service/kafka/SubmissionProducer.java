package com.MS_code_execution_platform.submission_service.kafka;

import com.MS_code_execution_platform.submission_service.dto.SubmissionEvent;
import com.MS_code_execution_platform.submission_service.entity.Submission;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class SubmissionProducer {

    private final KafkaTemplate<String, SubmissionEvent> kafkaTemplate;

    public void sendSubmissionEvent(Submission submission) {

        SubmissionEvent event = new SubmissionEvent(
                submission.getId(),
                submission.getUserId(),
                submission.getProblemId(),
                submission.getCode(),
                submission.getLanguage()
        );

        kafkaTemplate.send("submission-topic", event);
    }
}