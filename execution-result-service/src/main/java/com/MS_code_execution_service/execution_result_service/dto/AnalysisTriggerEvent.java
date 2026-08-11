package com.MS_code_execution_service.execution_result_service.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Published to analysis.trigger.v1 right after a judged result is persisted,
 * so ai-analysis-service can run its LLM analysis automatically instead of
 * waiting for a manual POST /ai/analyze call - see ai-analysis-service's new
 * Kafka consumer. Deliberately minimal: ai-analysis-service already knows
 * how to self-fetch everything else it needs from just a submissionId.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AnalysisTriggerEvent {
    private Long submissionId;
}
