-- Optional per-problem function signature (see harness package) and the
-- boilerplate generated from it. All nullable - problems without a signature
-- keep working exactly as before (raw stdin/stdout script judging).
ALTER TABLE problem
    ADD COLUMN function_name  varchar(255),
    ADD COLUMN params_json    TEXT,
    ADD COLUMN return_type    varchar(64),
    ADD COLUMN harness_python TEXT,
    ADD COLUMN harness_java   TEXT;
