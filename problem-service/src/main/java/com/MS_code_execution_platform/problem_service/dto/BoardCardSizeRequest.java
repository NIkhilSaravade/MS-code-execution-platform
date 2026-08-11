package com.MS_code_execution_platform.problem_service.dto;

import lombok.Data;

// Deliberately its own request type, separate from BoardCardRequest
// (title/color) - the rename PUT and this resize PATCH are independent
// operations; sharing one request DTO would mean a plain rename call (which
// never sends a size) accidentally wiping out a card's saved level back to
// null. Levels are 1-10, not raw pixels - see BoardCardService.clampLevel.
@Data
public class BoardCardSizeRequest {
    private Integer sizeLevel;
    private Integer fontLevel;
}
