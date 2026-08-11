package com.MS_code_execution_platform.problem_service.controller;

import com.MS_code_execution_platform.problem_service.dto.BoardPositionRequest;
import com.MS_code_execution_platform.problem_service.dto.BoardPositionResponse;
import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import com.MS_code_execution_platform.problem_service.service.BoardPositionService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

// Where each node has been dragged on the one shared board (see
// BoardCardController's comment), so a hand-arranged layout survives a page
// reload. Mirrors GraphPositionController for the Board view's own
// (separate) position set.
@RestController
@RequestMapping("/board/positions")
@RequiredArgsConstructor
public class BoardPositionController {

    private final BoardPositionService positionService;

    @GetMapping
    public List<BoardPositionResponse> listPositions() {
        return positionService.listPositions();
    }

    @PutMapping
    @PreAuthorize("hasRole('ADMIN')")
    public BoardPositionResponse savePosition(
            @RequestBody BoardPositionRequest request, @AuthenticationPrincipal Jwt jwt) {
        return positionService.savePosition(UUID.fromString(jwt.getSubject()), request);
    }

    @DeleteMapping("/{nodeType}/{nodeId}")
    @PreAuthorize("hasRole('ADMIN')")
    public void deletePosition(@PathVariable BoardNodeType nodeType, @PathVariable Long nodeId) {
        positionService.deletePosition(nodeType, nodeId);
    }
}
