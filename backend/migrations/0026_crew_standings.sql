-- Challenges and crew standings (IDEAS S-11, S-08): road data km per member and month, and the share of it they were first
-- to map (pioneer km); a published run's smoothness (0-100) so crews can be compared on how smoothly they drive, never on
-- speed. Totals only ever leave the server summed over a crew, or for the member themself.
CREATE TABLE member_months (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  km         REAL NOT NULL DEFAULT 0,
  pioneer_km REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
) WITHOUT ROWID;
ALTER TABLE board_entries ADD COLUMN smoothness INTEGER CHECK (smoothness BETWEEN 0 AND 100);
