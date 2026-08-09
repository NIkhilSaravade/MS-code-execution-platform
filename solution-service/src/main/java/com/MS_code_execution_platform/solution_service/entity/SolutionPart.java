package com.MS_code_execution_platform.solution_service.entity;

import jakarta.persistence.*;
import lombok.*;

// One expandable "Part N" bullet on the Solutions tab - stored as its own
// row (rather than one big markdown blob) so the frontend can fetch/render
// each part independently and an admin can edit/reorder one without
// touching the rest.
@Entity
@Table(name = "solution_part", uniqueConstraints = @UniqueConstraint(columnNames = {"solution_id", "ordinal"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SolutionPart {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "solution_id", nullable = false)
    private Solution solution;

    @Column(nullable = false)
    private Integer ordinal;

    @Column(nullable = false)
    private String title;

    // Prose only (no large blobs here) - fine as plain Postgres TEXT, same
    // as Submission.output/reason elsewhere in the platform.
    @Column(nullable = false, columnDefinition = "TEXT")
    private String markdown;
}
