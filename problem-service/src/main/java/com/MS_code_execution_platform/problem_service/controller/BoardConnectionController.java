package com.MS_code_execution_platform.problem_service.controller;

import com.MS_code_execution_platform.problem_service.dto.BoardConnectionRequest;
import com.MS_code_execution_platform.problem_service.dto.BoardConnectionResponse;
import com.MS_code_execution_platform.problem_service.service.BoardConnectionService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

// Per-user edges between board nodes (a problem or a BoardCard, in either
// combination), backing the Practice page's 2D "Board" view. Mirrors
// ConnectionController for the Board view's own (separate) edge set.
@RestController
@RequestMapping("/board/connections")
@RequiredArgsConstructor
public class BoardConnectionController {

    private final BoardConnectionService connectionService;

    @GetMapping
    public List<BoardConnectionResponse> listConnections(@AuthenticationPrincipal Jwt jwt) {
        return connectionService.listConnections(UUID.fromString(jwt.getSubject()));
    }

    @PostMapping
    public BoardConnectionResponse createConnection(
            @RequestBody BoardConnectionRequest request, @AuthenticationPrincipal Jwt jwt) {
        return connectionService.createConnection(UUID.fromString(jwt.getSubject()), request);
    }

    @DeleteMapping("/{id}")
    public void deleteConnection(@PathVariable Long id, @AuthenticationPrincipal Jwt jwt) {
        connectionService.deleteConnection(UUID.fromString(jwt.getSubject()), id);
    }
}
