-- 0004: real-time road data. Uploads merge immediately (no 14-day hold, no nightly job).
-- seen.d: the drive (hmac of the client's drive id) that first earned this person points on this road+direction.
ALTER TABLE seen ADD COLUMN d BLOB;
-- rank_slots.holder: hmac(user|way|dir) so one person cannot hold both slots; it cannot be reversed without the server pepper.
ALTER TABLE rank_slots ADD COLUMN holder BLOB;
-- Rate-limit counters by hour (pruned after 8 days). No road ids, no coordinates.
CREATE TABLE upload_counts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket  TEXT NOT NULL,                                 -- 'YYYY-MM-DDTHH' (UTC)
  uploads INTEGER NOT NULL DEFAULT 0,
  km      REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket)
);
