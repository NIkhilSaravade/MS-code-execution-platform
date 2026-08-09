package com.MS_code_execution_platform.solution_service.entity;

import jakarta.persistence.*;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "solution")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Solution {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // References problem-service's Problem.id - no FK/join across services,
    // same "just a number, verified at the call site" relationship
    // submission-service's Submission.problemId already has.
    @Column(nullable = false, unique = true)
    private Long problemId;

    // MinIO/S3 object key for this problem's step-through visualizer HTML
    // (see storage.SolutionAssetStorageService) - null until an admin
    // uploads one. Never stored in Postgres directly - see pom.xml's s3
    // dependency comment for why.
    private String visualizerObjectKey;

    @OneToMany(mappedBy = "solution", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("ordinal ASC")
    @Builder.Default
    private List<SolutionPart> parts = new ArrayList<>();
}
