package com.MS_code_execution_platform.problem_service.service;

import com.MS_code_execution_platform.problem_service.dto.ProblemRequest;
import com.MS_code_execution_platform.problem_service.dto.ProblemResponse;
import com.MS_code_execution_platform.problem_service.dto.TestCaseResponse;
import com.MS_code_execution_platform.problem_service.entity.Problem;
import com.MS_code_execution_platform.problem_service.entity.TestCase;
import com.MS_code_execution_platform.problem_service.repository.ProblemRepository;
import com.MS_code_execution_platform.problem_service.repository.TestCaseRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.*;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ProblemService {

    private final ProblemRepository problemRepository;
    private final TestCaseRepository testCaseRepository;

    public Problem createProblem(ProblemRequest request) {

        Problem problem = Problem.builder()
                .name(request.getName())
                .description(request.getDescription())
                .constraints(request.getConstraints())
                .build();

        List<TestCase> testCases = request.getTestCases()
                .stream()
                .map(tc -> TestCase.builder()
                        .input(tc.getInput())
                        .expectedOutput(tc.getExpectedOutput())
                        .hidden(tc.isHidden())
                        .problem(problem)
                        .build())
                .toList();

        problem.setTestCases(testCases);

        return problemRepository.save(problem);
    }

    public Page<ProblemResponse> getAllProblems(int page, int size) {

        Pageable pageable = PageRequest.of(page, size);
        Page<Problem> problems = problemRepository.findAll(pageable);

        return problems.map(problem ->
                ProblemResponse.builder()
                        .id(problem.getId())
                        .name(problem.getName())
                        .description(problem.getDescription())
                        .constraints(problem.getConstraints())
                        .build());
    }

    public List<TestCaseResponse> getTestCasesForWorker(Long problemId) {

        return testCaseRepository.findByProblemId(problemId)
                .stream()
                .map(tc -> TestCaseResponse.builder()
                        .input(tc.getInput())
                        .expectedOutput(tc.getExpectedOutput())
                        .build())
                .collect(Collectors.toList());
    }
}