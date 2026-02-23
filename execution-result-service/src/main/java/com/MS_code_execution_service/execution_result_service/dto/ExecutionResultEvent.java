package com.MS_code_execution_service.execution_result_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ExecutionResultEvent {

    private Long submissionId;
    private String output;
    private String status;
}
