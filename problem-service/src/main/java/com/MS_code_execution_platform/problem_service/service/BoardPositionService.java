package com.MS_code_execution_platform.problem_service.service;

import com.MS_code_execution_platform.problem_service.dto.BoardPositionRequest;
import com.MS_code_execution_platform.problem_service.dto.BoardPositionResponse;
import com.MS_code_execution_platform.problem_service.entity.BoardNodePosition;
import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import com.MS_code_execution_platform.problem_service.repository.BoardNodePositionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class BoardPositionService {

    private final BoardNodePositionRepository positionRepository;
    private final BoardNodeValidator nodeValidator;

    public List<BoardPositionResponse> listPositions(UUID userId) {
        return positionRepository.findByUserId(userId).stream()
                .map(BoardPositionService::toResponse)
                .toList();
    }

    // Upsert, keyed by (user, nodeType, nodeId) - the board re-saves a
    // node's position every time it's dropped, so re-dragging the same node
    // overwrites its previous spot rather than erroring or piling up rows.
    public BoardPositionResponse savePosition(UUID userId, BoardPositionRequest request) {
        if (request.getNodeType() == null || request.getNodeId() == null
                || request.getX() == null || request.getY() == null) {
            throw new IllegalArgumentException("nodeType, nodeId, x and y are required");
        }
        nodeValidator.requireExists(userId, request.getNodeType(), request.getNodeId());

        BoardNodePosition position = positionRepository
                .findByUserIdAndNodeTypeAndNodeId(userId, request.getNodeType(), request.getNodeId())
                .orElseGet(() -> BoardNodePosition.builder()
                        .userId(userId)
                        .nodeType(request.getNodeType())
                        .nodeId(request.getNodeId())
                        .build());
        position.setX(request.getX());
        position.setY(request.getY());
        position.setUpdatedAt(Instant.now());
        return toResponse(positionRepository.save(position));
    }

    @Transactional
    public void deletePosition(UUID userId, BoardNodeType nodeType, Long nodeId) {
        positionRepository.deleteByUserIdAndNodeTypeAndNodeId(userId, nodeType, nodeId);
    }

    private static BoardPositionResponse toResponse(BoardNodePosition position) {
        return BoardPositionResponse.builder()
                .nodeType(position.getNodeType())
                .nodeId(position.getNodeId())
                .x(position.getX())
                .y(position.getY())
                .build();
    }
}
