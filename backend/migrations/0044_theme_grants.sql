-- Private themes granted by hand (the owner, 2026-11-03: two car themes, Tiburon and FR-S, for the owner's account and his
-- co-developer's only). GET /api/me sends a granted account the theme's look (src/private_themes.json); no other account
-- gets it, signed out gets nothing. Written by hand only (no endpoint writes it); a row naming a theme the server doesn't
-- know is ignored. Goes with the account (cascade). Undo one grant: DELETE FROM theme_grants WHERE user_id = ? AND theme = ?.
CREATE TABLE theme_grants (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme      TEXT NOT NULL CHECK (length(theme) BETWEEN 1 AND 20),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, theme)
) WITHOUT ROWID;
