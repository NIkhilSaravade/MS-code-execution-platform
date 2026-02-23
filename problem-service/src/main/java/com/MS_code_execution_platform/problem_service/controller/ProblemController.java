package com.MS_code_execution_platform.problem_service.controller;

import com.MS_code_execution_platform.problem_service.dto.ProblemRequest;
import com.MS_code_execution_platform.problem_service.dto.ProblemResponse;
import com.MS_code_execution_platform.problem_service.dto.TestCaseResponse;
import com.MS_code_execution_platform.problem_service.entity.Problem;
import com.MS_code_execution_platform.problem_service.service.ProblemService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/problems")
@RequiredArgsConstructor
public class ProblemController {

    private final ProblemService problemService;

    @PostMapping
    public Problem createProblem(@RequestBody ProblemRequest request) {
        return problemService.createProblem(request);
    }

    @GetMapping("/getAll")
    public Page<ProblemResponse> getProblems(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {

        return problemService.getAllProblems(page, size);
    }

    // Used by Worker Service
    @GetMapping("/{problemId}/testcases")
    public List<TestCaseResponse> getTestCases(@PathVariable Long problemId) {
        return problemService.getTestCasesForWorker(problemId);
    }
}