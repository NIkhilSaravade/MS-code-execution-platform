package com.MS_code_execution_platform.solution_service.dto;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;

@Data
@Builder
public class NoteResponse {

    private String content;
    // Null if the caller has never saved a note for this problem yet.
    private Instant updatedAt;
}
