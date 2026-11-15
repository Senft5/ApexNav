-- Direct messages (2026-11-14, backend/src/messages.ts): one conversation per pair of members, written only while they are
-- friends; `pair` is the two user ids in order, joined by ':'. Kept a year (sweep.ts), gone with either account.
CREATE TABLE direct_messages (
  id         TEXT PRIMARY KEY,
  pair       TEXT NOT NULL,
  sender     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at    TEXT
);
CREATE INDEX dm_pair ON direct_messages(pair, created_at);
CREATE INDEX dm_unread ON direct_messages(recipient, read_at);
CREATE INDEX dm_sender ON direct_messages(sender, created_at);
