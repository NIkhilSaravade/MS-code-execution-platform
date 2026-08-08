package com.MS_code_execution_platform.submission_service.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Published to submissions.created.v1, consumed by worker-service-go.
 * Field names/JSON keys must match worker-service-go/internal/domain/events.go's
 * SubmissionCreatedEvent exactly - this is a cross-language contract, not
 * just an internal DTO.
 *
 * occurredAt is a pre-formatted RFC3339/ISO-8601 string (not java.time.Instant)
 * because spring-kafka's default JsonSerializer ObjectMapper writes Instant as
 * a numeric epoch timestamp, which Go's encoding/json can't unmarshal into a
 * time.Time field (it expects a quoted RFC3339 string).
 */
public record SubmissionCreatedEvent(
        @JsonProperty("event_id") String eventId,
        @JsonProperty("event_version") int eventVersion,
        @JsonProperty("occurred_at") String occurredAt,
        @JsonProperty("submission_id") String submissionId,
        @JsonProperty("user_id") String userId,
        @JsonProperty("problem_id") String problemId,
        @JsonProperty("problem_version_id") String problemVersionId,
        String language,
        @JsonProperty("code_s3_key") String codeS3Key,
        @JsonProperty("code_hash") String codeHash,
        @JsonProperty("include_hidden") boolean includeHidden
) {}
