package com.MS_code_execution_platform.solution_service.dto;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class SolutionResponse {

    private Long problemId;

    // Relative path (via api-gateway) the frontend points an <iframe> at -
    // null if no visualizer has been uploaded for this problem yet. Deliberately
    // NOT a presigned MinIO URL: MinIO's internal hostname ("minio") isn't
    // resolvable from the browser, only from other containers on the compose
    // network, so solution-service proxies the bytes itself instead (see
    // SolutionController's GET .../visualizer).
    private String visualizerUrl;

    private List<SolutionPartResponse> parts;
}
