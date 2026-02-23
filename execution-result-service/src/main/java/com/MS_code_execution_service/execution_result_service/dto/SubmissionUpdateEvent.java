package com.MS_code_execution_service.execution_result_service.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class SubmissionUpdateEvent {
    private Long submissionId;
    private String status;
}
