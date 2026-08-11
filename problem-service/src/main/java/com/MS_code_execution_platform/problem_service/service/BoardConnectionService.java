package com.MS_code_execution_platform.problem_service.service;

import com.MS_code_execution_platform.problem_service.dto.BoardConnectionRequest;
import com.MS_code_execution_platform.problem_service.dto.BoardConnectionResponse;
import com.MS_code_execution_platform.problem_service.entity.BoardConnection;
import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import com.MS_code_execution_platform.problem_service.repository.BoardConnectionRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class BoardConnectionService {

    private final BoardConnectionRepository connectionRepository;
    private final BoardNodeValidator nodeValidator;

    // One shared board - see BoardCardController's comment.
    public List<BoardConnectionResponse> listConnections() {
        return connectionRepository.findAll().stream()
                .map(BoardConnectionService::toResponse)
                .toList();
    }

    // Canonicalized by (type, id) so the same pair can never be stored twice
    // in opposite directions. Idempotent: re-requesting an existing pair
    // just returns it rather than erroring. creatorUserId is recorded as an
    // audit trail only (who added this edge), not used to scope anything.
    public BoardConnectionResponse createConnection(UUID creatorUserId, BoardConnectionRequest request) {
        if (request.getNodeAType() == null || request.getNodeAId() == null
                || request.getNodeBType() == null || request.getNodeBId() == null) {
            throw new IllegalArgumentException("nodeAType, nodeAId, nodeBType and nodeBId are required");
        }
        if (request.getNodeAType() == request.getNodeBType() && request.getNodeAId().equals(request.getNodeBId())) {
            throw new IllegalArgumentException("Cannot connect a node to itself");
        }

        nodeValidator.requireExists(request.getNodeAType(), request.getNodeAId());
        nodeValidator.requireExists(request.getNodeBType(), request.getNodeBId());

        boolean aFirst = isCanonicalOrder(
                request.getNodeAType(), request.getNodeAId(), request.getNodeBType(), request.getNodeBId());
        BoardNodeType aType = aFirst ? request.getNodeAType() : request.getNodeBType();
        Long aId = aFirst ? request.getNodeAId() : request.getNodeBId();
        BoardNodeType bType = aFirst ? request.getNodeBType() : request.getNodeAType();
        Long bId = aFirst ? request.getNodeBId() : request.getNodeAId();

        return connectionRepository
                .findByNodeATypeAndNodeAIdAndNodeBTypeAndNodeBId(aType, aId, bType, bId)
                .map(BoardConnectionService::toResponse)
                .orElseGet(() -> {
                    BoardConnection saved = connectionRepository.save(BoardConnection.builder()
                            .userId(creatorUserId)
                            .nodeAType(aType)
                            .nodeAId(aId)
                            .nodeBType(bType)
                            .nodeBId(bId)
                            .color(request.getColor())
                            .createdAt(Instant.now())
                            .build());
                    return toResponse(saved);
                });
    }

    public void deleteConnection(Long id) {
        BoardConnection connection = connectionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Connection not found: " + id));
        connectionRepository.delete(connection);
    }

    private static boolean isCanonicalOrder(BoardNodeType aType, Long aId, BoardNodeType bType, Long bId) {
        int typeCmp = aType.compareTo(bType);
        if (typeCmp != 0) return typeCmp < 0;
        return aId < bId;
    }

    private static BoardConnectionResponse toResponse(BoardConnection connection) {
        return BoardConnectionResponse.builder()
                .id(connection.getId())
                .nodeAType(connection.getNodeAType())
                .nodeAId(connection.getNodeAId())
                .nodeBType(connection.getNodeBType())
                .nodeBId(connection.getNodeBId())
                .color(connection.getColor())
                .build();
    }
}
