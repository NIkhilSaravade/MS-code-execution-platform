package com.MS_code_execution_platform.solution_service.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

// A user's own free-text notes for a problem - separate from Solution/
// SolutionPart (admin-authored content) since these are per-user, editable
// anytime, and don't require a written Solution to exist first. Not tied to
// Solution via FK for the same reason problemId elsewhere in this service
// isn't a real foreign key - just a plain reference, verified at the call
// site (see Solution's Javadoc).
@Entity
@Table(name = "solution_note", uniqueConstraints = @UniqueConstraint(columnNames = {"problem_id", "user_id"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SolutionNote {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "problem_id", nullable = false)
    private Long problemId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
