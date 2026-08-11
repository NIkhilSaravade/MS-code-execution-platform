package com.MS_code_execution_platform.problem_service.service;

import com.MS_code_execution_platform.problem_service.dto.BoardCardRequest;
import com.MS_code_execution_platform.problem_service.dto.BoardCardResponse;
import com.MS_code_execution_platform.problem_service.dto.BoardCardSizeRequest;
import com.MS_code_execution_platform.problem_service.entity.BoardCard;
import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import com.MS_code_execution_platform.problem_service.repository.BoardCardRepository;
import com.MS_code_execution_platform.problem_service.repository.BoardConnectionRepository;
import com.MS_code_execution_platform.problem_service.repository.BoardNodePositionRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class BoardCardService {

    private final BoardCardRepository cardRepository;
    private final BoardConnectionRepository connectionRepository;
    private final BoardNodePositionRepository positionRepository;

    // One shared board - every authenticated user sees the same cards (see
    // BoardCardController's comment); write methods below are additionally
    // gated ADMIN-only at the controller layer via @PreAuthorize.
    public List<BoardCardResponse> listCards() {
        return cardRepository.findAll().stream()
                .map(BoardCardService::toResponse)
                .toList();
    }

    public BoardCardResponse createCard(UUID creatorUserId, BoardCardRequest request) {
        String title = requireTitle(request);
        BoardCard saved = cardRepository.save(BoardCard.builder()
                .userId(creatorUserId)
                .title(title)
                .color(request.getColor())
                .createdAt(Instant.now())
                .build());
        return toResponse(saved);
    }

    public BoardCardResponse updateCard(Long id, BoardCardRequest request) {
        String title = requireTitle(request);
        BoardCard card = requireCard(id);
        card.setTitle(title);
        card.setColor(request.getColor());
        return toResponse(cardRepository.save(card));
    }

    // Independent of updateCard/rename on purpose - see BoardCardSizeRequest's
    // comment. Levels are clamped here (not just client-side) so a stray
    // out-of-range value from a buggy or malicious client can't produce an
    // invalid size.
    private static final int MIN_LEVEL = 1;
    private static final int MAX_LEVEL = 10;

    public BoardCardResponse resizeCard(Long id, BoardCardSizeRequest request) {
        BoardCard card = requireCard(id);
        card.setSizeLevel(clampLevel(request.getSizeLevel()));
        card.setFontLevel(clampLevel(request.getFontLevel()));
        return toResponse(cardRepository.save(card));
    }

    private static Integer clampLevel(Integer level) {
        if (level == null) return null;
        return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
    }

    // Deletes the card and, since nothing at the DB level enforces it, every
    // connection that referenced it as either endpoint plus its saved
    // position, if any - same cleanup GraphCardService.deleteCard does for
    // the 3D graph view's cards.
    @Transactional
    public void deleteCard(Long id) {
        BoardCard card = requireCard(id);
        connectionRepository.deleteAllReferencingCard(card.getId());
        positionRepository.deleteByNodeTypeAndNodeId(BoardNodeType.CARD, card.getId());
        cardRepository.delete(card);
    }

    private BoardCard requireCard(Long id) {
        return cardRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Card not found: " + id));
    }

    private static String requireTitle(BoardCardRequest request) {
        String title = request.getTitle() == null ? "" : request.getTitle().trim();
        if (title.isEmpty()) {
            throw new IllegalArgumentException("title is required");
        }
        return title;
    }

    private static BoardCardResponse toResponse(BoardCard card) {
        return BoardCardResponse.builder()
                .id(card.getId())
                .title(card.getTitle())
                .color(card.getColor())
                .sizeLevel(card.getSizeLevel())
                .fontLevel(card.getFontLevel())
                .build();
    }
}
