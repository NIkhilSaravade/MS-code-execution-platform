package com.MS_code_execution_platform.problem_service.controller;

import com.MS_code_execution_platform.problem_service.dto.BoardCardRequest;
import com.MS_code_execution_platform.problem_service.dto.BoardCardResponse;
import com.MS_code_execution_platform.problem_service.dto.BoardCardSizeRequest;
import com.MS_code_execution_platform.problem_service.service.BoardCardService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

// One shared, curated board on the Practice page's 2D "Board" view - every
// authenticated user sees the SAME cards (read-only for a plain USER: open
// problems, collapse/expand), only an ADMIN can create/rename/resize/delete
// one. userId is still recorded on creation as an audit trail of who added
// a given card, but no longer scopes what's visible or editable - see the
// git history for the earlier (per-user private board) design this replaced.
@RestController
@RequestMapping("/board/cards")
@RequiredArgsConstructor
public class BoardCardController {

    private final BoardCardService cardService;

    @GetMapping
    public List<BoardCardResponse> listCards() {
        return cardService.listCards();
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public BoardCardResponse createCard(@RequestBody BoardCardRequest request, @AuthenticationPrincipal Jwt jwt) {
        return cardService.createCard(UUID.fromString(jwt.getSubject()), request);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public BoardCardResponse updateCard(@PathVariable Long id, @RequestBody BoardCardRequest request) {
        return cardService.updateCard(id, request);
    }

    @PatchMapping("/{id}/size")
    @PreAuthorize("hasRole('ADMIN')")
    public BoardCardResponse resizeCard(@PathVariable Long id, @RequestBody BoardCardSizeRequest request) {
        return cardService.resizeCard(id, request);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public void deleteCard(@PathVariable Long id) {
        cardService.deleteCard(id);
    }
}
