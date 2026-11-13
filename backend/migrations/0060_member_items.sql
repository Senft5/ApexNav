-- Saved routes and pinned places on your account (big bet #11): what you save on one phone is there on the next, and after a
-- reinstall. One row per item; the newest change wins (`at`, the phone's clock in ms when you saved, pinned or removed it).
-- A removal keeps its row with body NULL for 60 days, so another phone that still has the item learns it went
-- (member_items.ts sweeps older ones). Your own, never shown to anyone; in the export, gone with the account.
CREATE TABLE member_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,                 -- 'route' (a saved route, web/saved_routes.js) or 'place' (a pinned place, web/pinned_places.js)
  item_id TEXT NOT NULL,                 -- the route's id, or the place's name in lower case
  body    TEXT,                          -- the item as the phone keeps it (JSON), NULL once removed
  at      INTEGER NOT NULL,              -- when it was saved or removed, ms
  seen    INTEGER NOT NULL,              -- when the server took it, ms: what a phone asks "since"
  PRIMARY KEY (user_id, kind, item_id)
) WITHOUT ROWID;
CREATE INDEX member_items_seen ON member_items(user_id, seen);
