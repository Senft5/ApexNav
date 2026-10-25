-- 0002: shared segments, so friends' scores land on the SAME stretch.
-- A segment copied ("adopted") from a friend keeps origin_id = the original's id. Boards match on the canonical id.
ALTER TABLE segments ADD COLUMN origin_id TEXT;
CREATE UNIQUE INDEX segments_owner_origin ON segments(owner, origin_id) WHERE origin_id IS NOT NULL;
CREATE TABLE segment_shares (
  segment_id    TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  audience_type TEXT NOT NULL CHECK (audience_type IN ('friend','crew')),
  audience_id   TEXT NOT NULL,
  PRIMARY KEY (segment_id, audience_type, audience_id)
);
ALTER TABLE board_entries ADD COLUMN canon_id TEXT;
CREATE INDEX board_canon ON board_entries(canon_id, audience_type, audience_id);
