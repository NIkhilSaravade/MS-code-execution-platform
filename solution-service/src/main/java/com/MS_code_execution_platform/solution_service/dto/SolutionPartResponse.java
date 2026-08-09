package com.MS_code_execution_platform.solution_service.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class SolutionPartResponse {

    private Integer ordinal;
    private String title;
    private String markdown;
}
