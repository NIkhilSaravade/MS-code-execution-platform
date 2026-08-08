-- Per-test-case judging detail (input/expected/actual/passed for each test
-- case, hidden ones only ever carry passed - never their content), reported
-- by either worker. Nullable - a submission judged before this existed, or
-- one that failed before reaching any test case (e.g. CE), has none.
ALTER TABLE submission
    ADD COLUMN test_case_results TEXT;
