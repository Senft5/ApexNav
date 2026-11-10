-- Roadbooks (docs/SOCIAL.md 2.6): a member's collection of great roads, kept private, shown to friends, or public for anyone
-- near them to find, follow and drive. A road is a planned shape with a name and a note: never a recorded drive, never a
-- time, a date or a speed. Additive only. Undo: DROP the four tables (nothing else reads them).
CREATE TABLE roadbooks (
  id          TEXT PRIMARY KEY,                                  -- 16 url-safe characters: it is also the link
  owner       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  about       TEXT,
  visibility  TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','friends','public')),
  area_lat    REAL,                                              -- the middle of its roads; null while it has none
  area_lon    REAL,
  roads_n     INTEGER NOT NULL DEFAULT 0,
  length_m    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX roadbooks_owner ON roadbooks(owner);
CREATE INDEX roadbooks_area ON roadbooks(visibility, area_lat, area_lon);

CREATE TABLE roadbook_roads (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES roadbooks(id) ON DELETE CASCADE,
  pos         INTEGER NOT NULL,
  name        TEXT NOT NULL,
  note        TEXT,
  geom        TEXT NOT NULL,                                     -- JSON [[lon, lat], …], at most 600 points
  length_m    INTEGER NOT NULL,
  south       REAL NOT NULL,                                     -- its box: a phone decides from this alone whether a drive could have covered it
  north       REAL NOT NULL,
  west        REAL NOT NULL,
  east        REAL NOT NULL,
  stamps      INTEGER NOT NULL DEFAULT 0,                        -- members whose own Log shows they drove it
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX roadbook_roads_book ON roadbook_roads(book_id, pos);

CREATE TABLE roadbook_follows (
  book_id     TEXT NOT NULL REFERENCES roadbooks(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (book_id, user_id)
) WITHOUT ROWID;
CREATE INDEX roadbook_follows_user ON roadbook_follows(user_id);

-- A stamp says "this member drove this road" without the table saying who: holder is an hmac of the member and the road
-- under the server's key (as rank_slots and road_hour_holders do), so a copy of the database names nobody.
CREATE TABLE roadbook_stamps (
  road_id     TEXT NOT NULL REFERENCES roadbook_roads(id) ON DELETE CASCADE,
  holder      BLOB NOT NULL,
  PRIMARY KEY (road_id, holder)
) WITHOUT ROWID;
