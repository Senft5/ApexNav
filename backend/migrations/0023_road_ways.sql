-- Where measured roads are, for the coverage map (IDEAS Q-14): each contributed way's OSM geometry (public map data, sent
-- with a contribution and simplified to at most 64 points; never the driver's own trace) and its bounding box.
CREATE TABLE road_ways (
  way_id  INTEGER PRIMARY KEY,
  s       REAL NOT NULL,
  w       REAL NOT NULL,
  n       REAL NOT NULL,
  e       REAL NOT NULL,
  shape   TEXT NOT NULL
);
CREATE INDEX road_ways_box ON road_ways (s, w);
