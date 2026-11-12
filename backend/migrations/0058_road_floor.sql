-- The two-driver privacy floor (roads.ts shownSql, MIN_DRIVERS) counts only established members: invited, or a member a week
-- or more (reports_sql.ts establishedSql). rank_slots still pays the first and second driver of a road whoever they are,
-- but a fresh account alone could otherwise unlock a lone driver's lane for everyone. At most two holders per road and
-- direction; holder is the same hmac(user|way|dir) as rank_slots.holder, never an id.
CREATE TABLE road_floor (
  way_id INTEGER NOT NULL,
  dir    INTEGER NOT NULL,
  holder BLOB NOT NULL,
  PRIMARY KEY (way_id, dir, holder)
) WITHOUT ROWID;
-- every driver who already holds a slot counts, as before
INSERT OR IGNORE INTO road_floor (way_id, dir, holder) SELECT way_id, dir, holder FROM rank_slots WHERE holder IS NOT NULL;
