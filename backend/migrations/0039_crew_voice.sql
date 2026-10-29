-- A Factory crew's regroup line (docs/design/REVIEW.md 5.1), e.g. "Ridge Runners, regroup.", rendered once in each voice
-- pack's own voice on the website (the same Kokoro voices as the packs) and kept as audio in KV (PHOTOS, key cv/<crew>/<pack>).
ALTER TABLE crews ADD COLUMN regroup_line TEXT;
CREATE TABLE crew_voice (
  crew_id    TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  pack       TEXT NOT NULL CHECK (pack IN ('marguerite', 'kit', 'hale')),
  bytes      INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (crew_id, pack)
);
