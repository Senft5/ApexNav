-- Crew drives, roadmap 21 (docs/design/REVIEW.md 3.3): who leads and who sweeps, and where the group regroups.
-- regroup is JSON [{ "name": "Overlook", "lat": .., "lon": .. }], at most 5.
ALTER TABLE crew_events ADD COLUMN lead_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE crew_events ADD COLUMN sweep_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE crew_events ADD COLUMN regroup TEXT NOT NULL DEFAULT '[]';
