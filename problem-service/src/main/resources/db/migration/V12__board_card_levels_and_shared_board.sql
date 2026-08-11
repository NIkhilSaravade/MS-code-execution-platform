-- Replaces the raw-pixel width/height (V10, V11) with a 1-10 "level" for
-- box size and title font size - the user wants to know "I've set this
-- card to level 7", not a pixel count. No live data to migrate: nothing had
-- actually saved a non-null width/height yet.
ALTER TABLE board_card
    DROP COLUMN width,
    DROP COLUMN height,
    ADD COLUMN size_level integer,
    ADD COLUMN font_level integer;
