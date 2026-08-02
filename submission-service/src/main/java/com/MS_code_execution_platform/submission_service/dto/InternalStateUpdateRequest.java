package com.MS_code_execution_platform.submission_service.dto;

import lombok.Data;

@Data
public class InternalStateUpdateRequest {

    private String state;
    private String reason;
}
