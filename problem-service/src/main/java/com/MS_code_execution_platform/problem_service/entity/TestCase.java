package com.MS_code_execution_platform.problem_service.entity;

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
    // input/expectedOutput above stay populated too, for the older Java
    // worker-service's GET /problems/{id}/testcases, which returns inline content.
    private String inputS3Key;
    private String expectedS3Key;
    private Integer ordinal;
    private boolean isSample;
    private Integer weight;

    @ManyToOne
    @JoinColumn(name = "problem_id")
    private Problem problem;
}