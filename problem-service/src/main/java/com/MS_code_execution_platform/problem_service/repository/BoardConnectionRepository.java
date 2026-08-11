package com.MS_code_execution_platform.problem_service.repository;

import com.MS_code_execution_platform.problem_service.entity.BoardConnection;
import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface BoardConnectionRepository extends JpaRepository<BoardConnection, Long> {

    Optional<BoardConnection> findByNodeATypeAndNodeAIdAndNodeBTypeAndNodeBId(
            BoardNodeType nodeAType, Long nodeAId, BoardNodeType nodeBType, Long nodeBId);

    // A board card has no real FK enforcing this (see BoardNodeType's
    // comment), so deleting a card explicitly sweeps up every edge that
    // referenced it as either endpoint.
    @Modifying
    @Query("delete from BoardConnection c where "
            + "(c.nodeAType = com.MS_code_execution_platform.problem_service.entity.BoardNodeType.CARD and c.nodeAId = :cardId) "
            + "or (c.nodeBType = com.MS_code_execution_platform.problem_service.entity.BoardNodeType.CARD and c.nodeBId = :cardId)")
    void deleteAllReferencingCard(@Param("cardId") Long cardId);
}
