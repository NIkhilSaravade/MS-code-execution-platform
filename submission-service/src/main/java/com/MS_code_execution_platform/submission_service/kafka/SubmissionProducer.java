package com.MS_code_execution_platform.submission_service.kafka;

import com.MS_code_execution_platform.submission_service.dto.SubmissionCreatedEvent;
import com.MS_code_execution_platform.submission_service.dto.SubmissionEvent;
import com.MS_code_execution_platform.submission_service.entity.Submission;
import com.MS_code_execution_platform.submission_service.storage.SubmissionCodeStorageService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class SubmissionProducer {

    private final KafkaTemplate<String, SubmissionEvent> kafkaTemplate;
    private final KafkaTemplate<String, SubmissionCreatedEvent> submissionCreatedKafkaTemplate;
    private final SubmissionCodeStorageService submissionCodeStorageService;

    @Value("${kafka.topic.submissions-created}")
    private String submissionsCreatedTopic;

    // codeToRun is deliberately a separate parameter from submission.getCode():
    // the DB keeps the user's ORIGINAL typed code (for display/history), but
    // what actually gets judged may have a generated harness appended (see
    // HarnessApplier) - the worker needs the combined, runnable version.

    // Legacy event, consumed by worker-service (Java) — carries the code inline.
    public void sendSubmissionEvent(Submission submission, String codeToRun) {

        SubmissionEvent event = new SubmissionEvent(
                submission.getId(),
                submission.getUserId(),
                submission.getProblemId(),
                codeToRun,
                submission.getLanguage()
        );

        kafkaTemplate.send("submission-topic", event);
    }

    // Newer event, consumed by worker-service-go — code is uploaded to
    // platform-artifacts first and referenced by key (job.CodeS3Key) instead
    // of being embedded, matching worker-service-go's SubmissionCreatedEvent
    // envelope (internal/domain/events.go).
    public void sendSubmissionCreatedEvent(Submission submission, String codeToRun) {

        SubmissionCodeStorageService.UploadResult upload = submissionCodeStorageService.upload(
                submission.getId(), submission.getLanguage(), codeToRun);

        String problemId = String.valueOf(submission.getProblemId());

        SubmissionCreatedEvent event = new SubmissionCreatedEvent(
                UUID.randomUUID().toString(),
                1,
                DateTimeFormatter.ISO_INSTANT.format(Instant.now()),
                String.valueOf(submission.getId()),
                submission.getUserId().toString(),
                problemId,
                // problem-service has no real problem-versioning table yet -
                // /internal/problem-versions/{id}/test-cases treats the id as
                // the problem id 1:1 (see InternalProblemController), so the
                // problem id doubles as the version id here.
                problemId,
                submission.getLanguage(),
                upload.s3Key(),
                upload.codeHash()
        );

        submissionCreatedKafkaTemplate.send(submissionsCreatedTopic, event);
    }
}