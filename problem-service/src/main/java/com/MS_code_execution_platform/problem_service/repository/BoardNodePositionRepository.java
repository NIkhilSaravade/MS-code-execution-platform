package com.MS_code_execution_platform.problem_service.repository;

import com.MS_code_execution_platform.problem_service.entity.BoardNodePosition;
import com.MS_code_execution_platform.problem_service.entity.BoardNodeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface BoardNodePositionRepository extends JpaRepository<BoardNodePosition, Long> {

    Optional<BoardNodePosition> findByNodeTypeAndNodeId(BoardNodeType nodeType, Long nodeId);

    void deleteByNodeTypeAndNodeId(BoardNodeType nodeType, Long nodeId);
}
