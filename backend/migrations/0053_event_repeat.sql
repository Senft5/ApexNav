-- Recurring meets (IDEAS S-13, docs/SOCIAL.md 2.11): a crew drive can repeat every 1, 2 or 4 weeks. Only the latest drive in
-- a series carries repeat_weeks; once it starts, the next one is planned (events.ts rollRepeats) and takes it over, so a
-- series is just its drives linked by series_id. Cancelling the latest, or its planner leaving the crew, ends the series.
-- Additive only. Undo: ALTER TABLE crew_events DROP COLUMN repeat_weeks; ALTER TABLE crew_events DROP COLUMN series_id.
ALTER TABLE crew_events ADD COLUMN repeat_weeks INTEGER CHECK (repeat_weeks IN (1, 2, 4));
ALTER TABLE crew_events ADD COLUMN series_id TEXT;
CREATE INDEX crew_events_repeat ON crew_events(repeat_weeks, starts_at) WHERE repeat_weeks IS NOT NULL;
