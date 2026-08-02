package com.MS_code_execution_platform.problem_service.service;

import com.MS_code_execution_platform.problem_service.dto.ProblemRequest;
import com.MS_code_execution_platform.problem_service.dto.ProblemResponse;
import com.MS_code_execution_platform.problem_service.dto.TestCaseDTO;
import com.MS_code_execution_platform.problem_service.dto.TestCaseResponse;
import com.MS_code_execution_platform.problem_service.entity.Problem;
import com.MS_code_execution_platform.problem_service.entity.TestCase;
import com.MS_code_execution_platform.problem_service.repository.ProblemRepository;
import com.MS_code_execution_platform.problem_service.repository.TestCaseRepository;
import com.MS_code_execution_platform.problem_service.storage.TestCaseStorageService;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.*;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ProblemService {

    private static final int DEFAULT_TIME_LIMIT_MS = 2000;
    private static final int DEFAULT_MEMORY_LIMIT_MB = 256;
    private static final int DEFAULT_WEIGHT = 1;

    private final ProblemRepository problemRepository;
    private final TestCaseRepository testCaseRepository;
    private final TestCaseStorageService testCaseStorageService;

    public Problem createProblem(ProblemRequest request) {

        Problem problem = Problem.builder()
                .name(request.getName())
                .description(request.getDescription())
                .constraints(request.getConstraints())
                .timeLimitMs(request.getTimeLimitMs() != null ? request.getTimeLimitMs() : DEFAULT_TIME_LIMIT_MS)
                .memoryLimitMb(request.getMemoryLimitMb() != null ? request.getMemoryLimitMb() : DEFAULT_MEMORY_LIMIT_MB)
                .build();

        // Save first so we have an id to key the S3 objects by.
        problem = problemRepository.save(problem);

        List<TestCaseDTO> requested = request.getTestCases();
        List<TestCase> testCases = new ArrayList<>();

        for (int ordinal = 0; ordinal < requested.size(); ordinal++) {
            TestCaseDTO tc = requested.get(ordinal);

            String inputKey = testCaseStorageService.upload(problem.getId(), ordinal, "input", tc.getInput());
            String expectedKey = testCaseStorageService.upload(problem.getId(), ordinal, "expected", tc.getExpectedOutput());

            testCases.add(TestCase.builder()
                    .input(tc.getInput())
                    .expectedOutput(tc.getExpectedOutput())
                    .hidden(tc.isHidden())
                    .inputS3Key(inputKey)
                    .expectedS3Key(expectedKey)
                    .ordinal(ordinal)
                    .isSample(!tc.isHidden())
                    .weight(DEFAULT_WEIGHT)
                    .problem(problem)
                    .build());
        }

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

    // Serves worker-service-go: test cases by S3 key rather than inline content.
    // There's no real problem-versioning yet, so problemVersionId == problemId
    // for now; a dedicated version table is a future enhancement.
    public List<TestCase> getTestCasesForVersion(Long problemVersionId) {
        return testCaseRepository.findByProblemId(problemVersionId);
    }

    public Problem getProblemOrThrow(Long problemId) {
        return problemRepository.findById(problemId)
                .orElseThrow(() -> new EntityNotFoundException(
                        "Problem not found: " + problemId));
    }
}