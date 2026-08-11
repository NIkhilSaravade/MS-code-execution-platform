-- Companion to V10's width column - the resize handle moved from a
-- right-edge-only (width-only) drag to a corner drag, resizing both
-- dimensions together.
ALTER TABLE board_card
    ADD COLUMN height integer;
