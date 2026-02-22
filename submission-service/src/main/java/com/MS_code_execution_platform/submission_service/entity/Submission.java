package com.MS_code_execution_platform.submission_service.entity;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "submissions")
@Getter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Submission {

    @Id
    private UUID id;

    private UUID userId;

    private String problemId;

    private String language;

    @Lob
    private String sourceCode;

    private String status;

    private Instant createdAt;
}
