package com.MS_code_execution_platform.submission_service.repository;

import com.MS_code_execution_platform.submission_service.entity.Submission;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface SubmissionRepository extends JpaRepository<Submission, UUID> {

}
