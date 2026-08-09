-- Persists whether a submission was a real Submit (judged against every
-- test case, hidden included) vs a Run (visible cases only) - previously
-- this was only a transient request flag (SubmissionRequest.includeHidden),
-- never stored, so there was no way to tell the two apart after the fact.
-- Needed to filter "past submissions" / "solved" to Submit-only, matching
-- LeetCode's own distinction (a passing Run is not the same as Accepted).
-- Existing rows predate the distinction and default to true (Submit) since
-- that was also the code's implicit default (see SubmissionService).
ALTER TABLE submission
    ADD COLUMN include_hidden boolean NOT NULL DEFAULT true;
