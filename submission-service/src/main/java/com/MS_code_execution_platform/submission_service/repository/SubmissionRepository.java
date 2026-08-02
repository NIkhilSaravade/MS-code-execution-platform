package com.MS_code_execution_platform.submission_service.repository;

import com.MS_code_execution_platform.submission_service.entity.Submission;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SubmissionRepository extends JpaRepository<Submission, Long> {

    List<Submission> findByUserId(UUID userId);

    // Query-scoping (never load by id alone): if the submission isn't the
    // caller's, the row simply isn't found - authorization can't be forgotten
    // because it's baked into the query itself.
    Optional<Submission> findByIdAndUserId(Long id, UUID userId);

}
