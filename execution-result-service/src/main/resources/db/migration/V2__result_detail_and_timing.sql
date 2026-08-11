-- execution-result-service becomes the single source of truth for judged
-- results (previously only ever populated submission_id/output/status - see
-- ExecutionResultService's old body). Adds the fields needed to serve
-- GET /api/results/{submissionId} as the frontend's full-detail source, and
-- fixes user_id, which was bigint but always holds a UUID string.

ALTER TABLE execution_result
    ALTER COLUMN user_id TYPE varchar(255) USING user_id::varchar,
    ADD COLUMN reason TEXT,
    ADD COLUMN test_case_results TEXT,
    ADD COLUMN wall_time_ms bigint,
    ADD COLUMN max_memory_kb bigint,
    ADD COLUMN estimated_time_complexity varchar(64),
    ADD COLUMN estimated_space_complexity varchar(64),
    DROP COLUMN execution_time;
