package com.MS_code_execution_platform.problem_service.dto;

import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class BoardConnectionResponse {
    private Long id;
    private BoardNodeType nodeAType;
    private Long nodeAId;
    private BoardNodeType nodeBType;
    private Long nodeBId;
    private String color;
}
