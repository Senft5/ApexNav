-- Crowd bump verification (IDEAS Q-02, docs/ROAD_INTELLIGENCE.md 4.3). Additive only. Each pass over a 5 m bin may say
-- whether the phone felt a spike there (`bp`: 1 hit, 0 a clean pass; unknown is not counted). The bin keeps the sums of
-- hits and passes, each weighted 2^((day - 2026-01-01) / BUMP.halfLifeDays) (contribute.ts): read today, an old pass counts
-- half as much every half-life (potholes get filled), with no exponent in SQL (D1 has no power()). roads.ts verifiedBumps
-- turns them into a Beta posterior. bump_drivers: how many different people hit something within about 10 m of the bin (a
-- hashed marker per person and 40 m in `seen`, never who). Undo: the columns are ignored by older code.
ALTER TABLE road_bins ADD COLUMN bump_hit REAL NOT NULL DEFAULT 0;
ALTER TABLE road_bins ADD COLUMN bump_pass REAL NOT NULL DEFAULT 0;
ALTER TABLE road_bins ADD COLUMN bump_drivers INTEGER NOT NULL DEFAULT 0;
