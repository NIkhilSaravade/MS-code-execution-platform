package com.MS_code_execution_platform.problem_service.service;

import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import com.MS_code_execution_platform.problem_service.repository.BoardCardRepository;
import com.MS_code_execution_platform.problem_service.repository.ProblemRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.UUID;

// Shared by BoardConnectionService and BoardPositionService: problems are
// global/shared (existence is all that matters, any authenticated user may
// reference one), but board cards are personal - a connection/position must
// only ever reference the CALLER's own card, so this doubles as the
// ownership check for CARD endpoints. Mirrors GraphNodeValidator for the
// Board view's own (separate) node set.
@Component
@RequiredArgsConstructor
public class BoardNodeValidator {

    private final ProblemRepository problemRepository;
    private final BoardCardRepository cardRepository;

    public void requireExists(UUID userId, BoardNodeType type, Long id) {
        boolean exists = switch (type) {
            case PROBLEM -> problemRepository.existsById(id);
            case CARD -> cardRepository.existsByIdAndUserId(id, userId);
        };
        if (!exists) {
            throw new IllegalArgumentException("No such " + type.name().toLowerCase() + ": " + id);
        }
    }
}
