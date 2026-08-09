package com.MS_code_execution_platform.submission_service.repository;

import com.MS_code_execution_platform.submission_service.entity.Submission;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SubmissionRepository extends JpaRepository<Submission, Long> {

    List<Submission> findByUserId(UUID userId);

    // Query-scoping (never load by id alone): if the submission isn't the
    // caller's, the row simply isn't found - authorization can't be forgotten
    // because it's baked into the query itself.
    Optional<Submission> findByIdAndUserId(Long id, UUID userId);

    // includeHidden = true only - the "Submissions" list is meant to mirror
    // LeetCode's own submissions history, which only ever records Submits,
    // never Runs.
    List<Submission> findByUserIdAndProblemIdAndIncludeHiddenTrueOrderBySubmittedAtDesc(UUID userId, Long problemId);

    // "PASSED" is the terminal verdict both workers use for a fully correct
    // submission (see worker-service-go's domain.VerdictPassed). Restricted
    // to includeHidden = true (a real Submit) - passing only the visible
    // cases on a Run isn't "solved", same distinction LeetCode makes between
    // a passing Run and an Accepted submission.
    @Query("select distinct s.problemId from Submission s where s.userId = :userId and s.status = 'PASSED' and s.includeHidden = true")
    List<Long> findSolvedProblemIds(@Param("userId") UUID userId);

}
