package com.MS_code_execution_platform.solution_service.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

// POST /solutions body (ADMIN-only) - an upsert: replaces every part for
// this problemId with exactly this list. See SolutionService.upsertSolution.
@Data
public class SolutionRequest {

    @NotNull
    private Long problemId;

    @NotEmpty
    @Valid
    private List<SolutionPartRequest> parts;
}
