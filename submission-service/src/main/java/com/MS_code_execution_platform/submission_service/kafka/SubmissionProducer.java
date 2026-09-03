package com.MS_code_execution_platform.submission_service.kafka;

import com.MS_code_execution_platform.submission_service.client.InternalProblemClient;
import com.MS_code_execution_platform.submission_service.dto.InternalLimitsResponse;
import com.MS_code_execution_platform.submission_service.dto.InternalTestCasesResponse;
import com.MS_code_execution_platform.submission_service.dto.SubmissionCreatedEvent;
import com.MS_code_execution_platform.submission_service.entity.Submission;
import com.MS_code_execution_platform.submission_service.storage.SubmissionCodeStorageService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class SubmissionProducer {

    private final KafkaTemplate<String, SubmissionCreatedEvent> submissionCreatedKafkaTemplate;
    private final SubmissionCodeStorageService submissionCodeStorageService;
    private final InternalProblemClient internalProblemClient;

    @Value("${kafka.topic.submissions-created}")
    private String submissionsCreatedTopic;

    // codeToRun is deliberately a separate parameter from submission.getCode():
    // the DB keeps the user's ORIGINAL typed code (for display/history), but
    // what actually gets judged may have a generated harness appended (see
    // HarnessApplier) - the worker needs the combined, runnable version.

    // Consumed by worker-service-go — code is uploaded to
    // platform-artifacts first and referenced by key (job.CodeS3Key) instead
    // of being embedded, matching worker-service-go's SubmissionCreatedEvent
    // envelope (internal/domain/events.go).
    public void sendSubmissionCreatedEvent(Submission submission, String codeToRun, boolean includeHidden) {

        SubmissionCodeStorageService.UploadResult upload = submissionCodeStorageService.upload(
                submission.getId(), submission.getLanguage(), codeToRun);

        String problemId = String.valueOf(submission.getProblemId());

        // Fetched once here (instead of once per worker, per submission) and
        // embedded into the event - see InternalProblemClient and the
        // "worker overhead at scale" motivation for this redesign.
        InternalTestCasesResponse testCases = internalProblemClient.getTestCases(submission.getProblemId());
        InternalLimitsResponse limits = internalProblemClient.getLimits(submission.getProblemId());
        List<com.MS_code_execution_platform.submission_service.dto.InternalTestCaseDTO> testCaseList =
                testCases != null && testCases.getTestCases() != null
                        ? testCases.getTestCases()
                        : Collections.emptyList();

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
                upload.codeHash(),
                includeHidden,
                testCaseList,
                limits != null ? limits.getTimeLimitMs() : 2000,
                limits != null ? limits.getMemoryLimitMb() : 256,
                submission.getCode()
        );

        submissionCreatedKafkaTemplate.send(submissionsCreatedTopic, event);
    }
}