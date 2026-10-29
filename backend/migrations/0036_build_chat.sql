-- Build-thread chat (docs/design/REVIEW.md 5.3): the back and forth that doesn't belong in the log, kept 30 days.
CREATE TABLE build_chat (
  id         TEXT PRIMARY KEY,
  build_id   TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  author     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX build_chat_build ON build_chat(build_id, created_at);
