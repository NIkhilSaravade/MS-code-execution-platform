package com.MS_code_execution_platform.submission_service.service;

import com.MS_code_execution_platform.submission_service.dto.SubmissionRequest;
import com.MS_code_execution_platform.submission_service.dto.SubmissionResponse;
import com.MS_code_execution_platform.submission_service.entity.Submission;
import com.MS_code_execution_platform.submission_service.messaging.SubmissionEventProducer;
import com.MS_code_execution_platform.submission_service.repository.SubmissionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class SubmissionService {

    private final SubmissionRepository repository;
    private final SubmissionEventProducer producer;

    public SubmissionResponse createSubmission(SubmissionRequest request, UUID userId) {

        Submission submission = Submission.builder()
                .id(UUID.randomUUID())
                .userId(userId)
                .problemId(request.getProblemId())
                .language(request.getLanguage())
                .sourceCode(request.getSourceCode())
                .status("CREATED")
                .createdAt(Instant.now())
                .build();

        repository.save(submission);
        producer.publishSubmissionCreated(submission);

        return new SubmissionResponse(submission.getId(), submission.getStatus());
    }
}
