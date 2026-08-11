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

    // One shared board - see BoardCardController's comment.
    public List<BoardPositionResponse> listPositions() {
        return positionRepository.findAll().stream()
                .map(BoardPositionService::toResponse)
                .toList();
    }

    // Upsert, keyed by (nodeType, nodeId) - the board re-saves a node's
    // position every time it's dropped, so re-dragging the same node
    // overwrites its previous spot rather than erroring or piling up rows.
    // lastEditedByUserId is recorded as an audit trail only.
    public BoardPositionResponse savePosition(UUID lastEditedByUserId, BoardPositionRequest request) {
        if (request.getNodeType() == null || request.getNodeId() == null
                || request.getX() == null || request.getY() == null) {
            throw new IllegalArgumentException("nodeType, nodeId, x and y are required");
        }
        nodeValidator.requireExists(request.getNodeType(), request.getNodeId());

        BoardNodePosition position = positionRepository
                .findByNodeTypeAndNodeId(request.getNodeType(), request.getNodeId())
                .orElseGet(() -> BoardNodePosition.builder()
                        .nodeType(request.getNodeType())
                        .nodeId(request.getNodeId())
                        .build());
        position.setUserId(lastEditedByUserId);
        position.setX(request.getX());
        position.setY(request.getY());
        position.setUpdatedAt(Instant.now());
        return toResponse(positionRepository.save(position));
    }

    @Transactional
    public void deletePosition(BoardNodeType nodeType, Long nodeId) {
        positionRepository.deleteByNodeTypeAndNodeId(nodeType, nodeId);
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
