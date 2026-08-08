package com.MS_code_execution_platform.problem_service.service;

import com.MS_code_execution_platform.problem_service.dto.FunctionParam;
import com.MS_code_execution_platform.problem_service.dto.FunctionSignature;
import com.MS_code_execution_platform.problem_service.dto.ProblemRequest;
import com.MS_code_execution_platform.problem_service.dto.ProblemResponse;
import com.MS_code_execution_platform.problem_service.dto.TestCaseDTO;
import com.MS_code_execution_platform.problem_service.dto.TestCaseResponse;
import com.MS_code_execution_platform.problem_service.entity.Problem;
import com.MS_code_execution_platform.problem_service.entity.TestCase;
import com.MS_code_execution_platform.problem_service.harness.HarnessGenerator;
import com.MS_code_execution_platform.problem_service.repository.ProblemRepository;
import com.MS_code_execution_platform.problem_service.repository.TestCaseRepository;
import com.MS_code_execution_platform.problem_service.storage.TestCaseStorageService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.data.domain.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class ProblemService {

    private static final int DEFAULT_TIME_LIMIT_MS = 2000;
    private static final int DEFAULT_MEMORY_LIMIT_MB = 256;
    private static final int DEFAULT_WEIGHT = 1;

    private final ProblemRepository problemRepository;
    private final TestCaseRepository testCaseRepository;
    private final TestCaseStorageService testCaseStorageService;
    private final Map<String, HarnessGenerator> harnessGenerators;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // Discovers every HarnessGenerator bean (one per supported language) and
    // indexes it by language() - adding a new language is registering one
    // new @Component, nothing here needs to change.
    public ProblemService(ProblemRepository problemRepository,
                           TestCaseRepository testCaseRepository,
                           TestCaseStorageService testCaseStorageService,
                           List<HarnessGenerator> generators) {
        this.problemRepository = problemRepository;
        this.testCaseRepository = testCaseRepository;
        this.testCaseStorageService = testCaseStorageService;
        this.harnessGenerators = generators.stream()
                .collect(Collectors.toMap(HarnessGenerator::language, g -> g));
    }

    // Redundant with the route-level rule in SecurityConfig by design: two
    // independent layers, so a missed/changed route pattern alone can't open
    // this up to non-admins.
    @PreAuthorize("hasRole('ADMIN')")
    public Problem createProblem(ProblemRequest request) {

        Problem.ProblemBuilder builder = Problem.builder()
                .name(request.getName())
                .description(request.getDescription())
                .constraints(request.getConstraints())
                .timeLimitMs(request.getTimeLimitMs() != null ? request.getTimeLimitMs() : DEFAULT_TIME_LIMIT_MS)
                .memoryLimitMb(request.getMemoryLimitMb() != null ? request.getMemoryLimitMb() : DEFAULT_MEMORY_LIMIT_MB);

        FunctionSignature signature = request.getSignature();
        if (signature != null) {
            builder.functionName(signature.getFunctionName())
                    .paramsJson(writeJson(signature.getParams()))
                    .returnType(signature.getReturnType())
                    .harnessByLanguage(generateHarnessByLanguage(signature));
        }

        Problem problem = builder.build();

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

        return problems.map(this::toResponse);
    }

    public List<TestCaseResponse> getTestCasesForWorker(Long problemId) {

        return testCaseRepository.findByProblemId(problemId)
                .stream()
                .map(tc -> TestCaseResponse.builder()
                        .input(tc.getInput())
                        .expectedOutput(tc.getExpectedOutput())
                        .hidden(tc.isHidden())
                        .build())
                .collect(Collectors.toList());
    }

    // Serves worker-service-go: test cases by S3 key rather than inline content.
    // There's no real problem-versioning yet, so problemVersionId == problemId
    // for now; a dedicated version table is a future enhancement.
    public List<TestCase> getTestCasesForVersion(Long problemVersionId) {
        return testCaseRepository.findByProblemId(problemVersionId);
    }

    // Re-runs every currently-registered HarnessGenerator against a problem's
    // already-stored function signature, overwriting harnessByLanguage. This
    // is how an existing problem picks up support for a language added
    // after it was created - re-POSTing the whole problem isn't necessary.
    @PreAuthorize("hasRole('ADMIN')")
    public ProblemResponse regenerateHarness(Long problemId) {
        Problem problem = getProblemOrThrow(problemId);
        if (problem.getFunctionName() == null) {
            throw new IllegalStateException(
                    "Problem " + problemId + " has no function signature - nothing to regenerate");
        }

        FunctionSignature signature = new FunctionSignature(
                problem.getFunctionName(), readParams(problem.getParamsJson()), problem.getReturnType());

        problem.setHarnessByLanguage(generateHarnessByLanguage(signature));
        problem = problemRepository.save(problem);

        return toResponse(problem);
    }

    private Map<String, String> generateHarnessByLanguage(FunctionSignature signature) {
        Map<String, String> result = new HashMap<>();
        harnessGenerators.forEach((lang, generator) -> result.put(lang, generator.generate(signature)));
        return result;
    }

    public Problem getProblemOrThrow(Long problemId) {
        return problemRepository.findById(problemId)
                .orElseThrow(() -> new EntityNotFoundException(
                        "Problem not found: " + problemId));
    }

    public ProblemResponse getProblemResponse(Long problemId) {
        return toResponse(getProblemOrThrow(problemId));
    }

    private ProblemResponse toResponse(Problem problem) {
        return ProblemResponse.builder()
                .id(problem.getId())
                .name(problem.getName())
                .description(problem.getDescription())
                .constraints(problem.getConstraints())
                .functionName(problem.getFunctionName())
                .params(readParams(problem.getParamsJson()))
                .returnType(problem.getReturnType())
                .harnessByLanguage(problem.getHarnessByLanguage())
                .build();
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("failed to serialize function signature params", e);
        }
    }

    private List<FunctionParam> readParams(String paramsJson) {
        if (paramsJson == null) {
            return null;
        }
        try {
            return objectMapper.readValue(paramsJson, new TypeReference<List<FunctionParam>>() {});
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("failed to deserialize function signature params", e);
        }
    }
}