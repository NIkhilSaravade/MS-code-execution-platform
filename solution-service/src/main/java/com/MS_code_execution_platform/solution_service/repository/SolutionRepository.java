package com.MS_code_execution_platform.solution_service.repository;

import com.MS_code_execution_platform.solution_service.entity.Solution;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SolutionRepository extends JpaRepository<Solution, Long> {

    Optional<Solution> findByProblemId(Long problemId);
}
