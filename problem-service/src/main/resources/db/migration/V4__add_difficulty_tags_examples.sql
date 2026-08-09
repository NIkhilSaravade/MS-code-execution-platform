-- Adds the fields needed for the admin "Add Problem" UI - previously Problem
-- only had name/description/constraints/test cases/optional function
-- signature, with no room for difficulty, tags, or the worked examples shown
-- on the Solve page's Description tab. tags/examples follow the same
-- JSON-in-a-TEXT-column pattern harness_by_language already uses (see
-- V3__harness_by_language.sql) rather than a join table, since both are
-- write-once-at-creation, read-whole.
ALTER TABLE problem
    ADD COLUMN difficulty varchar(20) NOT NULL DEFAULT 'Medium',
    ADD COLUMN tags TEXT,
    ADD COLUMN examples TEXT;
