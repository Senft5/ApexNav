-- Build threads (roadmap 23): the last post number a follower has seen, so "Builds you follow" can say what's new.
ALTER TABLE build_follows ADD COLUMN seen_n INTEGER NOT NULL DEFAULT 0;
