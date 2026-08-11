-- Result detail (output/reason/testCaseResults) is no longer stored here -
-- execution-result-service is now the single source of truth for judged
-- results (GET /api/results/{submissionId}). This table only tracks a
-- submission's lifecycle/status, updated via submission-update-topic.
ALTER TABLE submission
    DROP COLUMN output,
    DROP COLUMN reason,
    DROP COLUMN test_case_results;
