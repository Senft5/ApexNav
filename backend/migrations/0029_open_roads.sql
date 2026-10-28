-- Single-pass roads (owner decision 2026-10-28): a road driven once is shown, with low confidence, when it is an open road
-- nobody lives at the end of. The way's road class (Valhalla road_class, from the phone's map match) and its map length decide
-- that; unknown stays NULL and keeps the two-driver rule (IDEAS Z-08). Both describe the public map line, never a drive.
ALTER TABLE road_ways ADD COLUMN cls TEXT;
ALTER TABLE road_ways ADD COLUMN len_m REAL;
