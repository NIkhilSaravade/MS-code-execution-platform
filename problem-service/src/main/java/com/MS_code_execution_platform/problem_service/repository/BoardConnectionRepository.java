package com.MS_code_execution_platform.problem_service.repository;

import com.MS_code_execution_platform.problem_service.entity.BoardConnection;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface BoardConnectionRepository extends JpaRepository<BoardConnection, Long> {

    List<BoardConnection> findByUserId(UUID userId);

    Optional<BoardConnection> findByUserIdAndNodeATypeAndNodeAIdAndNodeBTypeAndNodeBId(
            UUID userId,
            com.MS_code_execution_platform.problem_service.entity.BoardNodeType nodeAType,
            Long nodeAId,
            com.MS_code_execution_platform.problem_service.entity.BoardNodeType nodeBType,
            Long nodeBId);

    Optional<BoardConnection> findByIdAndUserId(Long id, UUID userId);

    // A board card has no real FK enforcing this (see BoardNodeType's
    // comment), so deleting a card explicitly sweeps up every edge of the
    // owning user's that referenced it as either endpoint.
    @Modifying
    @Query("delete from BoardConnection c where c.userId = :userId and "
            + "((c.nodeAType = com.MS_code_execution_platform.problem_service.entity.BoardNodeType.CARD and c.nodeAId = :cardId) "
            + "or (c.nodeBType = com.MS_code_execution_platform.problem_service.entity.BoardNodeType.CARD and c.nodeBId = :cardId))")
    void deleteAllReferencingCard(@Param("userId") UUID userId, @Param("cardId") Long cardId);
}
