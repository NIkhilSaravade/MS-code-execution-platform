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

    private Long userId;
    private Long problemId;

    @Column(columnDefinition = "TEXT")
    private String code;

    private String language;

    private String status; // PENDING, SUCCESS, FAILED

    private String output;

    private LocalDateTime submittedAt;
}