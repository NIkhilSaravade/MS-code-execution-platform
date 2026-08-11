package com.MS_code_execution_platform.problem_service.dto;

import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import lombok.Data;

@Data
public class BoardPositionRequest {
    private BoardNodeType nodeType;
    private Long nodeId;
    private Double x;
    private Double y;
}
