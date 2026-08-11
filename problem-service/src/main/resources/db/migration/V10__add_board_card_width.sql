-- Lets a user manually widen a pattern/category card on the Board view (see
-- the drag-handle resize on ProblemBoard2D's card boxes) - nullable, since
-- most cards use the default width computed from their content and never
-- get resized.
ALTER TABLE board_card
    ADD COLUMN width integer;
