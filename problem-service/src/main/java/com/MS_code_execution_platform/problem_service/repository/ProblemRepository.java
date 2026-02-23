package com.MS_code_execution_platform.problem_service.repository;

import com.MS_code_execution_platform.problem_service.entity.Problem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ProblemRepository extends JpaRepository<Problem, Long> {

}