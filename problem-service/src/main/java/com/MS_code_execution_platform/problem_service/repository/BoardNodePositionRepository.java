package com.MS_code_execution_platform.problem_service.repository;

import com.MS_code_execution_platform.problem_service.entity.BoardNodePosition;
import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface BoardNodePositionRepository extends JpaRepository<BoardNodePosition, Long> {

    List<BoardNodePosition> findByUserId(UUID userId);

    Optional<BoardNodePosition> findByUserIdAndNodeTypeAndNodeId(UUID userId, BoardNodeType nodeType, Long nodeId);

    void deleteByUserIdAndNodeTypeAndNodeId(UUID userId, BoardNodeType nodeType, Long nodeId);
}
