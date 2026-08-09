package com.MS_code_execution_platform.solution_service.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class SolutionPartRequest {

    @NotNull
    private Integer ordinal;

    @NotBlank
    private String title;

    @NotBlank
    private String markdown;
}
