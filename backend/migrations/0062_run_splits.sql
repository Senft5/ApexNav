-- Live ghost duels (IDEAS D-04, owner 2026-11-10/11: time duels): a stage result can carry its splits, the elapsed time at
-- evenly spaced points along the stage, so a friend driving it later hears "+0.3 vs @sam" live and sees the gap corner by
-- corner. Kept only where the result's time is (share_times; set NULL with it when times stop being shared), and the
-- road surface the run was on (dry / wet / ice, road_surface.js), so a duel compares like with like. Additive only.
-- Undo: ALTER TABLE board_entries DROP COLUMN splits; ALTER TABLE board_entries DROP COLUMN surface;
ALTER TABLE board_entries ADD COLUMN splits TEXT;
ALTER TABLE board_entries ADD COLUMN surface TEXT CHECK (surface IN ('dry', 'wet', 'ice'));
