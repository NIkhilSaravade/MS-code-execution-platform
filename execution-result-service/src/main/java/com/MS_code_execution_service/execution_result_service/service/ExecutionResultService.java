package com.MS_code_execution_service.execution_result_service.service;

import com.MS_code_execution_service.execution_result_service.dto.AnalysisTriggerEvent;
import com.MS_code_execution_service.execution_result_service.dto.ExecutionResultEvent;
import com.MS_code_execution_service.execution_result_service.dto.SubmissionUpdateEvent;
import com.MS_code_execution_service.execution_result_service.entity.ExecutionResult;
import com.MS_code_execution_service.execution_result_service.repository.ExecutionResultRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ExecutionResultService {

    private final ExecutionResultRepository repository;
    private final KafkaTemplate<String, SubmissionUpdateEvent> kafkaTemplate;
    private final KafkaTemplate<String, AnalysisTriggerEvent> analysisTriggerKafkaTemplate;

    public void processExecutionResult(ExecutionResultEvent event) {

        Long submissionId = Long.valueOf(event.getSubmissionId());
        Long problemId = event.getProblemId() != null ? Long.valueOf(event.getProblemId()) : null;

        ExecutionResult result = ExecutionResult.builder()
                .submissionId(submissionId)
                .problemId(problemId)
                .userId(event.getUserId())
                .output(event.getOutput())
                .status(event.getStatus())
                .reason(event.getReason())
                .testCaseResults(event.getTestCaseResults() == null || event.getTestCaseResults().isNull()
                        ? null
                        : event.getTestCaseResults().toString())
                .wallTimeMs(event.getWallTimeMs())
                .maxMemoryKb(event.getMaxMemoryKb())
                .estimatedTimeComplexity(event.getEstimatedTimeComplexity())
                .estimatedSpaceComplexity(event.getEstimatedSpaceComplexity())
                .build();

        repository.save(result);

        // Single write-back path to submission-service - see
        // submission-service's SubmissionUpdateConsumer, which replaced both
        // the old direct Kafka consumer and the Go worker's HTTP callback.
        kafkaTemplate.send("submission-update-topic",
                SubmissionUpdateEvent.builder()
                        .submissionId(submissionId)
                        .status(event.getStatus())
                        .build());

        // Auto-trigger ai-analysis-service's LLM analysis - best-effort and
        // fully decoupled from the deterministic result above: if
        // ai-analysis-service is down or slow, this submission's judged
        // result is already saved and visible, unaffected.
        analysisTriggerKafkaTemplate.send("analysis.trigger.v1",
                AnalysisTriggerEvent.builder()
                        .submissionId(submissionId)
                        .build());
    }
}
