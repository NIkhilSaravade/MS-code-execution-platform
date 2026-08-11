package com.MS_code_execution_platform.problem_service.controller;

import com.MS_code_execution_platform.problem_service.dto.BoardPositionRequest;
import com.MS_code_execution_platform.problem_service.dto.BoardPositionResponse;
import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import com.MS_code_execution_platform.problem_service.service.BoardPositionService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

// Where the user has manually dragged each node on the Practice page's 2D
// "Board" view, so a hand-arranged layout survives a page reload. Mirrors
// GraphPositionController for the Board view's own (separate) position set.
@RestController
@RequestMapping("/board/positions")
@RequiredArgsConstructor
public class BoardPositionController {

    private final BoardPositionService positionService;

    @GetMapping
    public List<BoardPositionResponse> listPositions(@AuthenticationPrincipal Jwt jwt) {
        return positionService.listPositions(UUID.fromString(jwt.getSubject()));
    }

    @PutMapping
    public BoardPositionResponse savePosition(
            @RequestBody BoardPositionRequest request, @AuthenticationPrincipal Jwt jwt) {
        return positionService.savePosition(UUID.fromString(jwt.getSubject()), request);
    }

    @DeleteMapping("/{nodeType}/{nodeId}")
    public void deletePosition(
            @PathVariable BoardNodeType nodeType, @PathVariable Long nodeId, @AuthenticationPrincipal Jwt jwt) {
        positionService.deletePosition(UUID.fromString(jwt.getSubject()), nodeType, nodeId);
    }
}
