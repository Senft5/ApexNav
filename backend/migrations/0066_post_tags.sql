-- Who came, on a drive post to friends (2026-11-15, backend/src/drive_posts.ts): the author tags up to five friends they
-- drove with. A tagged friend sees "With @you" on the post, a For you line, and can take their own tag off. Gone with the
-- post or either account.
CREATE TABLE drive_post_tags (
  post_id    TEXT NOT NULL REFERENCES drive_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX drive_post_tags_user ON drive_post_tags(user_id, created_at);
