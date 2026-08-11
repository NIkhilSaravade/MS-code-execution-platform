package com.MS_code_execution_platform.problem_service.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class BoardCardResponse {
    private Long id;
    private String title;
    private String color;
    private Integer sizeLevel;
    private Integer fontLevel;
}
