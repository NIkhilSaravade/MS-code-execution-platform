package com.MS_code_execution_platform.problem_service.repository;

import com.MS_code_execution_platform.problem_service.entity.BoardCard;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface BoardCardRepository extends JpaRepository<BoardCard, Long> {

    List<BoardCard> findByUserId(UUID userId);

    Optional<BoardCard> findByIdAndUserId(Long id, UUID userId);

    boolean existsByIdAndUserId(Long id, UUID userId);
}
