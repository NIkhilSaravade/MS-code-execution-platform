package com.MS_code_execution_platform.problem_service.entity;

import com.fasterxml.jackson.annotation.JsonBackReference;
import jakarta.persistence.*;
import lombok.*;

@Entity
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TestCase {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(columnDefinition = "TEXT")
    private String input;

    @Column(columnDefinition = "TEXT")
    private String expectedOutput;

    private boolean hidden;

    // S3-backed fields for worker-service-go (see TestCaseStorageService).
    // input/expectedOutput above stay populated too, for GET
    // /problems/{id}/testcases (the admin edit page), which returns inline content.
    //
    // Explicit @Column names: Hibernate's default naming strategy handles a
    // digit next to an uppercase letter surprisingly - "inputS3Key" becomes
    // "inputs3key" with no underscores at all, not the readable "input_s3_key"
    // - found by actually booting this service against a real migration.
    @Column(name = "input_s3_key")
    private String inputS3Key;

    @Column(name = "expected_s3_key")
    private String expectedS3Key;

    private Integer ordinal;
    private boolean isSample;
    private Integer weight;

    @ManyToOne
    @JoinColumn(name = "problem_id")
    @JsonBackReference
    private Problem problem;
}