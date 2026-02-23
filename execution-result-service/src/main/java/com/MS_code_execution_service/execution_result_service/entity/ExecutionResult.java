package com.MS_code_execution_service.execution_result_service.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ExecutionResult {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long submissionId;
    private Long problemId;
    private Long userId;

    @Lob
    private String output;

    private String status;  // PASSED / FAILED / ERROR

    private Long executionTime;
}