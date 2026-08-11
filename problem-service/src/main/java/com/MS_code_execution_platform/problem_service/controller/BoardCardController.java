package com.MS_code_execution_platform.problem_service.controller;

import com.MS_code_execution_platform.problem_service.dto.BoardCardRequest;
import com.MS_code_execution_platform.problem_service.dto.BoardCardResponse;
import com.MS_code_execution_platform.problem_service.service.BoardCardService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

// Personal, free-standing pattern/category nodes on the Practice page's 2D
// "Board" view - each user only ever sees/edits their own, enforced in
// BoardCardService. Mirrors GraphCardController for the Board view's own
// (separate) node set.
@RestController
@RequestMapping("/board/cards")
@RequiredArgsConstructor
public class BoardCardController {

    private final BoardCardService cardService;

    @GetMapping
    public List<BoardCardResponse> listCards(@AuthenticationPrincipal Jwt jwt) {
        return cardService.listCards(UUID.fromString(jwt.getSubject()));
    }

    @PostMapping
    public BoardCardResponse createCard(@RequestBody BoardCardRequest request, @AuthenticationPrincipal Jwt jwt) {
        return cardService.createCard(UUID.fromString(jwt.getSubject()), request);
    }

    @PutMapping("/{id}")
    public BoardCardResponse updateCard(
            @PathVariable Long id, @RequestBody BoardCardRequest request, @AuthenticationPrincipal Jwt jwt) {
        return cardService.updateCard(UUID.fromString(jwt.getSubject()), id, request);
    }

    @DeleteMapping("/{id}")
    public void deleteCard(@PathVariable Long id, @AuthenticationPrincipal Jwt jwt) {
        cardService.deleteCard(UUID.fromString(jwt.getSubject()), id);
    }
}
