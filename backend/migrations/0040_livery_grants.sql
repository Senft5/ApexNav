-- Full crew customization granted by hand (the owner, 2026-10-30: "my account should have full access to crew
-- customization"). A crew with a granted member has the Factory livery whatever its Decals, and the granted user counts
-- as Pro for their own Decals controls. Written by hand only (no endpoint writes it); docs/CALL_SHEET.md.
CREATE TABLE livery_grants (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
