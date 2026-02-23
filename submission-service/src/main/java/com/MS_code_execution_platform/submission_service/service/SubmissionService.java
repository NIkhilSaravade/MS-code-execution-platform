package com.MS_code_execution_platform.submission_service.service;

import com.MS_code_execution_platform.submission_service.dto.ExecutionResultEvent;
import com.MS_code_execution_platform.submission_service.dto.SubmissionRequest;
import com.MS_code_execution_platform.submission_service.dto.SubmissionResponse;
import com.MS_code_execution_platform.submission_service.entity.Submission;
import com.MS_code_execution_platform.submission_service.kafka.SubmissionProducer;
import com.MS_code_execution_platform.submission_service.repository.SubmissionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class SubmissionService {

    private final SubmissionRepository submissionRepository;
    private final SubmissionProducer submissionProducer;

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

        submissionProducer.sendSubmissionEvent(submission);

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

        submissionRepository.save(submission);
    }
}
