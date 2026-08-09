package com.MS_code_execution_platform.solution_service.service;

import com.MS_code_execution_platform.solution_service.dto.SolutionPartRequest;
import com.MS_code_execution_platform.solution_service.dto.SolutionPartResponse;
import com.MS_code_execution_platform.solution_service.dto.SolutionRequest;
import com.MS_code_execution_platform.solution_service.dto.SolutionResponse;
import com.MS_code_execution_platform.solution_service.entity.Solution;
import com.MS_code_execution_platform.solution_service.entity.SolutionPart;
import com.MS_code_execution_platform.solution_service.repository.SolutionNoteRepository;
import com.MS_code_execution_platform.solution_service.repository.SolutionRepository;
import com.MS_code_execution_platform.solution_service.storage.SolutionAssetStorageService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.util.Comparator;
import java.util.NoSuchElementException;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class SolutionService {

    private final SolutionRepository solutionRepository;
    private final SolutionNoteRepository solutionNoteRepository;
    private final SolutionAssetStorageService assetStorageService;

    @Transactional(readOnly = true)
    public SolutionResponse getByProblemId(Long problemId) {
        return toResponse(getSolutionOrThrow(problemId));
    }

    // Full replace, not a merge: every call replaces the complete part list
    // for this problem, matching how the frontend/admin tooling always edits
    // "the whole write-up" rather than one part in isolation.
    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public SolutionResponse upsertSolution(SolutionRequest request) {
        Solution solution = solutionRepository.findByProblemId(request.getProblemId())
                .orElseGet(() -> Solution.builder().problemId(request.getProblemId()).build());

        // Flush the clear() (orphanRemoval DELETEs) before adding the new
        // parts - without this, Hibernate can flush the new rows' INSERTs
        // before the old rows' DELETEs within the same transaction, and a
        // reused ordinal (e.g. replacing a 2-part draft with the same
        // problem's real 12 parts) trips solution_part's (solution_id,
        // ordinal) unique constraint even though the end state is valid.
        solution.getParts().clear();
        solution = solutionRepository.saveAndFlush(solution);

        for (SolutionPartRequest partRequest : request.getParts()) {
            solution.getParts().add(SolutionPart.builder()
                    .solution(solution)
                    .ordinal(partRequest.getOrdinal())
                    .title(partRequest.getTitle())
                    .markdown(partRequest.getMarkdown())
                    .build());
        }

        return toResponse(solutionRepository.save(solution));
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public SolutionResponse uploadVisualizer(Long problemId, MultipartFile file) {
        Solution solution = solutionRepository.findByProblemId(problemId)
                .orElseGet(() -> Solution.builder().problemId(problemId).build());

        solution.setVisualizerObjectKey(assetStorageService.uploadVisualizer(problemId, file));
        return toResponse(solutionRepository.save(solution));
    }

    @Transactional(readOnly = true)
    public byte[] getVisualizerContent(Long problemId) {
        Solution solution = getSolutionOrThrow(problemId);
        if (solution.getVisualizerObjectKey() == null) {
            throw new NoSuchElementException("No visualizer uploaded for problem " + problemId);
        }
        return assetStorageService.download(solution.getVisualizerObjectKey());
    }

    // No-op (not an error) if this problem never had a solution written -
    // deleting a problem that was never documented is a completely normal
    // case, not something worth failing the caller over.
    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public void deleteSolution(Long problemId) {
        Optional<Solution> existing = solutionRepository.findByProblemId(problemId);
        existing.ifPresent(solution -> {
            if (solution.getVisualizerObjectKey() != null) {
                assetStorageService.delete(solution.getVisualizerObjectKey());
            }
            solutionRepository.delete(solution); // solution_part cascades via ON DELETE CASCADE
        });
        solutionNoteRepository.deleteByProblemId(problemId);
    }

    private Solution getSolutionOrThrow(Long problemId) {
        return solutionRepository.findByProblemId(problemId)
                .orElseThrow(() -> new NoSuchElementException("No solution for problem " + problemId));
    }

    private SolutionResponse toResponse(Solution solution) {
        return SolutionResponse.builder()
                .problemId(solution.getProblemId())
                .visualizerUrl(solution.getVisualizerObjectKey() != null
                        ? "/solutions/problem/" + solution.getProblemId() + "/visualizer"
                        : null)
                .parts(solution.getParts().stream()
                        .sorted(Comparator.comparing(SolutionPart::getOrdinal))
                        .map(p -> SolutionPartResponse.builder()
                                .ordinal(p.getOrdinal())
                                .title(p.getTitle())
                                .markdown(p.getMarkdown())
                                .build())
                        .toList())
                .build();
    }
}
