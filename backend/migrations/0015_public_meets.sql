-- Car meets (IDEAS S-13): a public crew can list one of its drives for everyone nearby (crew_events.public). Only while the
-- crew stays public and the drive isn't hidden by reports; people see the crew, time, meeting point and how many are going.
ALTER TABLE crew_events ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
CREATE INDEX crew_events_public ON crew_events(public, meet_lat, meet_lon);
