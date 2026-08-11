package com.MS_code_execution_platform.problem_service.dto;

import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class BoardPositionResponse {
    private BoardNodeType nodeType;
    private Long nodeId;
    private double x;
    private double y;
}
