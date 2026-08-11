package com.MS_code_execution_platform.problem_service.service;

import com.MS_code_execution_platform.problem_service.dto.BoardCardRequest;
import com.MS_code_execution_platform.problem_service.dto.BoardCardResponse;
import com.MS_code_execution_platform.problem_service.entity.BoardCard;
import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import com.MS_code_execution_platform.problem_service.repository.BoardCardRepository;
import com.MS_code_execution_platform.problem_service.repository.BoardConnectionRepository;
import com.MS_code_execution_platform.problem_service.repository.BoardNodePositionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
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

    public List<BoardCardResponse> listCards(UUID userId) {
        return cardRepository.findByUserId(userId).stream()
                .map(BoardCardService::toResponse)
                .toList();
    }

    public BoardCardResponse createCard(UUID userId, BoardCardRequest request) {
        String title = requireTitle(request);
        BoardCard saved = cardRepository.save(BoardCard.builder()
                .userId(userId)
                .title(title)
                .color(request.getColor())
                .createdAt(Instant.now())
                .build());
        return toResponse(saved);
    }

    public BoardCardResponse updateCard(UUID userId, Long id, BoardCardRequest request) {
        String title = requireTitle(request);
        BoardCard card = cardRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new AccessDeniedException("Card not found"));
        card.setTitle(title);
        card.setColor(request.getColor());
        return toResponse(cardRepository.save(card));
    }

    // Deletes the card and, since nothing at the DB level enforces it, every
    // connection of this user's that referenced it as either endpoint plus
    // its saved position, if any - same cleanup GraphCardService.deleteCard
    // does for the 3D graph view's cards.
    @Transactional
    public void deleteCard(UUID userId, Long id) {
        BoardCard card = cardRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new AccessDeniedException("Card not found"));
        connectionRepository.deleteAllReferencingCard(userId, card.getId());
        positionRepository.deleteByUserIdAndNodeTypeAndNodeId(userId, BoardNodeType.CARD, card.getId());
        cardRepository.delete(card);
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
                .build();
    }
}
