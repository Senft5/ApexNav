-- Your driving DNA beside a friend's (web/dna_card.js): the six skill levels of Your driving, your style in three words and
-- the kind of corner you are cleanest in, as the phone last read them. Shown only to an accepted friend you share scores
-- with (the same grant as your stage scores), never across a block. Never pace, a speed or a time. One row a member; in
-- Download my data; gone with the account.
CREATE TABLE driver_dna (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  body    TEXT NOT NULL,                 -- JSON { skills: { squeeze, brake, arc, entry, line, exit }, style: [..], size, corners, drives }
  at      INTEGER NOT NULL               -- when the server took it, ms
) WITHOUT ROWID;
