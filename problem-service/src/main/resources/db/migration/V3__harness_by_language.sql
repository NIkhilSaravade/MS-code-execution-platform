-- Replace the one-column-per-language harness storage with a single JSON
-- map column (language -> generated boilerplate), so adding a new language
-- never needs a schema migration again - see Problem.harnessByLanguage.
-- Existing rows lose their stored harness_python/harness_java content;
-- POST /problems/{id}/harness/regenerate backfills it from each problem's
-- already-stored function signature.
ALTER TABLE problem
    ADD COLUMN harness_by_language TEXT,
    DROP COLUMN harness_python,
    DROP COLUMN harness_java;
