package com.MS_code_execution_service.execution_result_service.feign;

import com.MS_code_execution_service.execution_result_service.dto.ProblemResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

@FeignClient(name = "problem-service")
public interface ProblemClient {

    @GetMapping("/api/problems/{id}")
    ProblemResponse getProblemById(@PathVariable("id") Long id);
}