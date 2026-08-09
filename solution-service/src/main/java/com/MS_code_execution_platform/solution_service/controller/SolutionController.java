package com.MS_code_execution_platform.solution_service.controller;

import com.MS_code_execution_platform.solution_service.dto.NoteRequest;
import com.MS_code_execution_platform.solution_service.dto.NoteResponse;
import com.MS_code_execution_platform.solution_service.dto.SolutionRequest;
import com.MS_code_execution_platform.solution_service.dto.SolutionResponse;
import com.MS_code_execution_platform.solution_service.service.SolutionNoteService;
import com.MS_code_execution_platform.solution_service.service.SolutionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;

@RestController
@RequestMapping("/solutions")
@RequiredArgsConstructor
public class SolutionController {

    private final SolutionService solutionService;
    private final SolutionNoteService solutionNoteService;

    @GetMapping("/problem/{problemId}")
    public SolutionResponse getByProblemId(@PathVariable Long problemId) {
        return solutionService.getByProblemId(problemId);
    }

    @PostMapping
    public SolutionResponse upsertSolution(@Valid @RequestBody SolutionRequest request) {
        return solutionService.upsertSolution(request);
    }

    @PostMapping(value = "/problem/{problemId}/visualizer", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public SolutionResponse uploadVisualizer(@PathVariable Long problemId, @RequestParam("file") MultipartFile file) {
        return solutionService.uploadVisualizer(problemId, file);
    }

    @DeleteMapping("/problem/{problemId}")
    public void deleteSolution(@PathVariable Long problemId) {
        solutionService.deleteSolution(problemId);
    }

    // Deliberately unauthenticated (see SecurityConfig) - the browser loads
    // this straight into an <iframe src="..."> with no way to attach an
    // Authorization header, and visualizer content isn't sensitive. Streamed
    // through this service rather than a presigned MinIO URL because MinIO's
    // container hostname isn't resolvable from the browser - see
    // SolutionResponse.visualizerUrl's comment.
    @GetMapping("/problem/{problemId}/visualizer")
    public ResponseEntity<byte[]> getVisualizer(@PathVariable Long problemId) {
        byte[] content = solutionService.getVisualizerContent(problemId);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "text/html; charset=utf-8")
                .body(content);
    }

    // The caller's own notes for this problem - userId comes from the JWT
    // subject, never from the request, so there's no path/body userId to
    // spoof (unlike submission-service's endpoints, which take a userId
    // path segment and have to explicitly guard it - this design has no
    // such value to check in the first place).
    @GetMapping("/problem/{problemId}/notes")
    public NoteResponse getNote(@PathVariable Long problemId, @AuthenticationPrincipal Jwt jwt) {
        return solutionNoteService.getNote(problemId, UUID.fromString(jwt.getSubject()));
    }

    @PutMapping("/problem/{problemId}/notes")
    public NoteResponse saveNote(
            @PathVariable Long problemId,
            @Valid @RequestBody NoteRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        return solutionNoteService.saveNote(problemId, UUID.fromString(jwt.getSubject()), request.getContent());
    }
}
