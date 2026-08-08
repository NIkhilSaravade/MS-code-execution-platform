package com.MS_code_execution_platform.submission_service.entity;
import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.UUID;


@Entity
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Submission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private UUID userId;
    private Long problemId;

    @Column(columnDefinition = "TEXT")
    private String code;

    private String language;

    private String status; // PENDING, SUCCESS, FAILED

    private String output;

    // Populated on state transitions reported by worker-service (e.g. a system error detail)
    private String reason;

    // JSON array of per-test-case results (see dto.TestCaseResult), reported
    // by either worker. @JsonRawValue on the getter (see below) so this
    // appears as real nested JSON in API responses, not an escaped string.
    @Column(columnDefinition = "TEXT")
    @com.fasterxml.jackson.annotation.JsonRawValue
    private String testCaseResults;

    private LocalDateTime submittedAt;
}