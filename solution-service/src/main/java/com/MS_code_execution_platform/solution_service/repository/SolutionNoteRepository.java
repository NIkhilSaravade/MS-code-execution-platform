package com.MS_code_execution_platform.solution_service.repository;

import com.MS_code_execution_platform.solution_service.entity.SolutionNote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface SolutionNoteRepository extends JpaRepository<SolutionNote, Long> {

    Optional<SolutionNote> findByProblemIdAndUserId(Long problemId, UUID userId);

    // Used when a problem is deleted (see SolutionService.deleteSolution) -
    // every user's notes on a problem that no longer exists are meaningless.
    void deleteByProblemId(Long problemId);
}
