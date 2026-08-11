package com.MS_code_execution_platform.submission_service.entity;
import com.fasterxml.jackson.annotation.JsonFormat;
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

    private String status; // PENDING, RUNNING, PASSED, FAILED, ...

    // true = a real Submit (judged against every test case, hidden
    // included); false = a Run (visible cases only). See
    // SubmissionRequest.includeHidden - this is where that flag ends up
    // persisted, so past-submissions/solved queries can filter to Submits.
    private Boolean includeHidden;

    // Result detail (output/reason/testCaseResults/timing/complexity) is no
    // longer stored here - execution-result-service is the single source of
    // truth for judged results (GET /api/results/{submissionId}). This
    // entity only tracks a submission's lifecycle/status, updated via the
    // submission-update-topic consumer once execution-result-service has
    // persisted the full result.

    // LocalDateTime.now() has no timezone info attached, but this JVM's
    // system clock IS UTC (Docker default) - without @JsonFormat here, the
    // serialized JSON has no offset/'Z' marker, and browsers parse a
    // date-time string with no timezone as LOCAL time rather than UTC, so
    // no conversion ever happens: a submission made at 17:41 UTC (23:11 IST)
    // rendered as "5:41 PM" instead of "11:11 PM" - the raw UTC clock value
    // displayed as if it were already local. Explicitly marking this UTC
    // lets the browser convert it correctly.
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'", timezone = "UTC")
    private LocalDateTime submittedAt;
}