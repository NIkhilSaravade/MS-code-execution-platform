package com.MS_code_execution_platform.solution_service.service;

import com.MS_code_execution_platform.solution_service.dto.NoteResponse;
import com.MS_code_execution_platform.solution_service.entity.SolutionNote;
import com.MS_code_execution_platform.solution_service.repository.SolutionNoteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class SolutionNoteService {

    private final SolutionNoteRepository noteRepository;

    @Transactional(readOnly = true)
    public NoteResponse getNote(Long problemId, UUID userId) {
        return noteRepository.findByProblemIdAndUserId(problemId, userId)
                .map(n -> NoteResponse.builder().content(n.getContent()).updatedAt(n.getUpdatedAt()).build())
                // No note saved yet - not an error, just an empty starting point.
                .orElseGet(() -> NoteResponse.builder().content("").updatedAt(null).build());
    }

    @Transactional
    public NoteResponse saveNote(Long problemId, UUID userId, String content) {
        SolutionNote note = noteRepository.findByProblemIdAndUserId(problemId, userId)
                .orElseGet(() -> SolutionNote.builder().problemId(problemId).userId(userId).build());

        note.setContent(content);
        note.setUpdatedAt(Instant.now());
        note = noteRepository.save(note);

        return NoteResponse.builder().content(note.getContent()).updatedAt(note.getUpdatedAt()).build();
    }
}
