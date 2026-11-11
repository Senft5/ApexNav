-- Time duels (docs/SOCIAL.md 2.7; the owner, 2026-11-11: "we should have time duel and score duel"): a duel is decided by
-- the higher Vetta Score ('score', every duel made before this) or by the quicker time ('time'), from runs each side
-- already shares with the other (a time only under that side's share_times grant). Additive only.
-- Undo: ALTER TABLE duels DROP COLUMN kind.
ALTER TABLE duels ADD COLUMN kind TEXT NOT NULL DEFAULT 'score' CHECK (kind IN ('score', 'time'));
