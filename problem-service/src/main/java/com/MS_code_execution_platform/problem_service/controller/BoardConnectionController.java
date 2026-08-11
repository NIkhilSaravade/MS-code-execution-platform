package com.MS_code_execution_platform.problem_service.controller;

import com.MS_code_execution_platform.problem_service.dto.BoardConnectionRequest;
import com.MS_code_execution_platform.problem_service.dto.BoardConnectionResponse;
import com.MS_code_execution_platform.problem_service.service.BoardConnectionService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

// Edges on the one shared board (see BoardCardController's comment) between
// board nodes (a problem or a BoardCard, in either combination). Mirrors
// ConnectionController for the Board view's own (separate) edge set.
@RestController
@RequestMapping("/board/connections")
@RequiredArgsConstructor
public class BoardConnectionController {

    private final BoardConnectionService connectionService;

    @GetMapping
    public List<BoardConnectionResponse> listConnections() {
        return connectionService.listConnections();
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public BoardConnectionResponse createConnection(
            @RequestBody BoardConnectionRequest request, @AuthenticationPrincipal Jwt jwt) {
        return connectionService.createConnection(UUID.fromString(jwt.getSubject()), request);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public void deleteConnection(@PathVariable Long id) {
        connectionService.deleteConnection(id);
    }
}
