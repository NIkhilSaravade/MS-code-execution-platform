package com.MS_code_execution_platform.submission_service.service;

import com.MS_code_execution_platform.submission_service.dto.ExecutionResultEvent;
import com.MS_code_execution_platform.submission_service.dto.SubmissionRequest;
import com.MS_code_execution_platform.submission_service.dto.SubmissionResponse;
import com.MS_code_execution_platform.submission_service.entity.Submission;
import com.MS_code_execution_platform.submission_service.kafka.SubmissionProducer;
import com.MS_code_execution_platform.submission_service.repository.SubmissionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.NoSuchElementException;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class SubmissionService {

    private final SubmissionRepository submissionRepository;
    private final SubmissionProducer submissionProducer;
    private final HarnessApplier harnessApplier;

    // THE WORKER SWITCH. "java" routes every new submission to the legacy
    // worker-service (submission-topic / execution-result-topic); "go" routes
    // it to worker-service-go (submissions.created.v1 / executions.completed.v1).
    // Only ONE worker ever sees a given submission - both dual-publishing and
    // consuming would otherwise race two independent judges against each
    // other for the same submission with no way to know which result you'd get.
    // Set via ACTIVE_WORKER in docker-compose.yml (or application.properties'
    // worker.active for a local, non-Docker run) - change it and restart
    // submission-service to switch.
    @Value("${worker.active}")
    private String activeWorker;

    public SubmissionResponse createSubmission(SubmissionRequest request) {

        Submission submission = Submission.builder()
                .userId(request.getUserId())
                .problemId(request.getProblemId())
                .code(request.getCode())
                .language(request.getLanguage())
                .status("PENDING")
                .submittedAt(LocalDateTime.now())
                .build();

        submission = submissionRepository.save(submission);

        // The DB row above keeps the user's ORIGINAL code; codeToRun is what
        // actually gets judged - the same code with a generated harness
        // appended, if the problem has one for this language (see
        // HarnessApplier - falls back to the original code unchanged
        // otherwise, same as before harnesses existed).
        String codeToRun = harnessApplier.apply(
                submission.getProblemId(), submission.getLanguage(), submission.getCode());

        // Default to true (full Submit semantics) unless the frontend
        // explicitly asked for a Run (visible-only) evaluation.
        boolean includeHidden = !Boolean.FALSE.equals(request.getIncludeHidden());

        if ("go".equalsIgnoreCase(activeWorker)) {
            submissionProducer.sendSubmissionCreatedEvent(submission, codeToRun, includeHidden);
        } else {
            submissionProducer.sendSubmissionEvent(submission, codeToRun, includeHidden);
        }

        return SubmissionResponse.builder()
                .submissionId(submission.getId())
                .status(submission.getStatus())
                .build();
    }

    public void updateSubmissionResult(ExecutionResultEvent event) {

        Submission submission = submissionRepository
                .findById(event.getSubmissionId())
                .orElseThrow();

        submission.setStatus(event.getStatus());
        submission.setOutput(event.getOutput());
        if (event.getTestCaseResults() != null && !event.getTestCaseResults().isNull()) {
            submission.setTestCaseResults(event.getTestCaseResults().toString());
        }

        submissionRepository.save(submission);
    }

    // Called by worker-service-go over HTTP - this IS the terminal-result path
    // for the Go worker (see SubmissionClient.MarkTerminal): unlike the Java
    // worker, which reports results via the execution-result-topic Kafka
    // consumer below, nothing currently consumes executions.completed.v1 back
    // into submission-service, so this HTTP call is not just "faster
    // optimistic feedback" for that path - it's the only thing that ever
    // moves a Go-routed submission out of RUNNING.
    public void updateState(Long submissionId, String state, String reason, String output, String testCaseResults) {

        Submission submission = submissionRepository.findById(submissionId)
                .orElseThrow(() -> new NoSuchElementException(
                        "Submission not found: " + submissionId));

        submission.setStatus(state);
        submission.setReason(reason);
        if (output != null) {
            submission.setOutput(output);
        }
        if (testCaseResults != null) {
            submission.setTestCaseResults(testCaseResults);
        }

        submissionRepository.save(submission);
    }
}
