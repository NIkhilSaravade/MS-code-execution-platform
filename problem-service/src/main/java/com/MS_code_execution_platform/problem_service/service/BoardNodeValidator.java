package com.MS_code_execution_platform.problem_service.service;

import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import com.MS_code_execution_platform.problem_service.repository.BoardCardRepository;
import com.MS_code_execution_platform.problem_service.repository.ProblemRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

// Shared by BoardConnectionService and BoardPositionService: both problems
// and board cards are global/shared now (see the one-shared-board design -
// BoardCardController's comment), so this is just an existence check, not
// an ownership check. Mirrors GraphNodeValidator for the Board view's own
// (separate) node set.
@Component
@RequiredArgsConstructor
public class BoardNodeValidator {

    private final ProblemRepository problemRepository;
    private final BoardCardRepository cardRepository;

    public void requireExists(BoardNodeType type, Long id) {
        boolean exists = switch (type) {
            case PROBLEM -> problemRepository.existsById(id);
            case CARD -> cardRepository.existsById(id);
        };
        if (!exists) {
            throw new IllegalArgumentException("No such " + type.name().toLowerCase() + ": " + id);
        }
    }
}
