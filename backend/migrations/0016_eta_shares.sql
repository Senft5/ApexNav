-- Share your ETA (IDEAS S-19): a link that says "@nate is about 12 min away, arriving 5:42 PM" and nothing else: no
-- position, no route, no destination. Only the token's hash is stored. Ends on arrival, when stopped, or after 4 hours.
CREATE TABLE eta_shares (
  token_hash TEXT PRIMARY KEY,
  owner      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  arrive_at  TEXT NOT NULL,                              -- UTC 'YYYY-MM-DD HH:MM:SS'
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ended      TEXT CHECK (ended IN ('arrived','stopped'))
) WITHOUT ROWID;
CREATE INDEX eta_shares_owner ON eta_shares(owner);
