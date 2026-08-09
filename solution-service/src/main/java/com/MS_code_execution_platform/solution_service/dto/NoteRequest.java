package com.MS_code_execution_platform.solution_service.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

// PUT .../notes body - content may be an empty string (clearing the note),
// just never null.
@Data
public class NoteRequest {

    @NotNull
    private String content;
}
