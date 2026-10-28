-- Crowd curvature (IDEAS Q-04): the curvature of members' driven paths per 5 m bin (phones have always sent it, `k`), kept as
-- a running mean so planned routes can correct corners the map simplified. Road geometry only, never a speed or a person.
ALTER TABLE road_bins ADD COLUMN k_mean REAL;
ALTER TABLE road_bins ADD COLUMN k_n INTEGER NOT NULL DEFAULT 0;
