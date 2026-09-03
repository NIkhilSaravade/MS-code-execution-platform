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

    // Full-replace update (see ProblemService.updateProblem's Javadoc) -
    // returns ProblemResponse rather than the raw entity createProblem
    // returns, so this one never risks echoing hidden test cases' expected
    // output back in the response body.
    @PutMapping("/{problemId}")
    public ProblemResponse updateProblem(@PathVariable Long problemId, @RequestBody ProblemRequest request) {
        return problemService.updateProblem(problemId, request);
    }

    @DeleteMapping("/{problemId}")
    public void deleteProblem(@PathVariable Long problemId) {
        problemService.deleteProblem(problemId);
    }

    // Backfills an existing problem's harnessByLanguage using every
    // currently-registered HarnessGenerator - the way an already-seeded
    // problem picks up a language added after it was created (see
    // ProblemService.regenerateHarness).
    @PostMapping("/{problemId}/harness/regenerate")
    public ProblemResponse regenerateHarness(@PathVariable Long problemId) {
        return problemService.regenerateHarness(problemId);
    }

    @GetMapping("/getAll")
    public Page<ProblemResponse> getProblems(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {

        return problemService.getAllProblems(page, size);
    }

    // Metadata only (no test case content) - safe for any authenticated user,
    // unlike /testcases below which exposes hidden test cases' expected output.
    @GetMapping("/{problemId}")
    public ProblemResponse getProblem(@PathVariable Long problemId) {
        return problemService.getProblemResponse(problemId);
    }

    // Exposes hidden test cases' expected output - only the frontend's
    // ADMIN-gated edit page calls this (see api/problems.ts's getTestCases),
    // but nothing here or in SecurityConfig actually restricts it to ADMIN:
    // any authenticated USER token can call this directly and read hidden
    // test case answers. Needs @PreAuthorize("hasRole('ADMIN')"), same
    // pattern as ProblemService.regenerateHarness.
    @GetMapping("/{problemId}/testcases")
    public List<TestCaseResponse> getTestCases(@PathVariable Long problemId) {
        return problemService.getTestCasesForWorker(problemId);
    }
}