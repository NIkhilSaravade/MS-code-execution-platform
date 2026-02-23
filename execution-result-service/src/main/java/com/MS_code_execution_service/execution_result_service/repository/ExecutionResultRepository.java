package com.MS_code_execution_service.execution_result_service.repository;

import com.MS_code_execution_service.execution_result_service.entity.ExecutionResult;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExecutionResultRepository extends JpaRepository<ExecutionResult, Long> {

}
