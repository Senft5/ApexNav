-- Drive posts and the friends feed (docs/SOCIAL.md 2.13, big bet #4): after a drive, one tap posts its card to your friends
-- or to one of your crews; friends give kudos and comment. The line is the drive's shape with both ends cut (the phone cuts
-- its privacy zones and 500 m, the server cuts 500 m again), never a time on it or a speed. Gone with the post or the account.
CREATE TABLE drive_posts (
  id         TEXT PRIMARY KEY,
  author     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crew_id    TEXT REFERENCES crews(id) ON DELETE CASCADE,       -- NULL: to your friends; else to that crew's members
  title      TEXT NOT NULL,                                      -- the drive's name, 60 characters at most
  caption    TEXT,                                               -- what the driver says about it, 280 at most
  driven_on  TEXT NOT NULL,                                      -- YYYY-MM-DD, the day only
  length_m   INTEGER,
  score      INTEGER,                                            -- the drive's Vetta Score, or NULL
  roads      TEXT,                                               -- JSON: up to 8 road names driven
  stages     TEXT,                                               -- JSON: up to 3 stages driven, [{name, score}]
  line       TEXT,                                               -- encoded polyline (1e5), ends cut, 600 points at most
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX drive_posts_author ON drive_posts(author, created_at);
CREATE INDEX drive_posts_crew ON drive_posts(crew_id, created_at);

CREATE TABLE drive_post_kudos (
  post_id    TEXT NOT NULL REFERENCES drive_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
) WITHOUT ROWID;

CREATE TABLE drive_comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES drive_posts(id) ON DELETE CASCADE,
  author     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,                                      -- plain text, 280 characters at most
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX drive_comments_post ON drive_comments(post_id, created_at);
CREATE INDEX drive_comments_author ON drive_comments(author);
