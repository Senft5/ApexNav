-- Route intelligence: the driver, the car and the crowd (docs/ROUTING.md "Route context"). Additive only; nothing existing
-- changes meaning. Undo: the new columns are ignored by older code; DROP the three new tables to remove them.

-- Flow confidence per 5 m bin (crowd.js `crowd_flow`): how steadily members drive it. Each pass sends `fl`, its speed
-- steadiness over about 40 m (1 = even, 0 = stopped or stop-start; a ratio, never the speed), and `hb`, 1 when it braked
-- hard where no corner ahead explains it (a junction, traffic, a surprise). Running means with the same memory as roughness.
ALTER TABLE road_bins ADD COLUMN flow_mean REAL;
ALTER TABLE road_bins ADD COLUMN brake_mean REAL;
ALTER TABLE road_bins ADD COLUMN flow_n INTEGER NOT NULL DEFAULT 0;

-- Loved roads (crowd.js `loved`): how many members came back to drive a road+direction again on a recorded drive (a second,
-- different recorded drive of it). Counted once per person (a `seen` marker), never who; shown as a level, never the count,
-- and only under the open-road / two-driver rule.
CREATE TABLE road_love (
  way_id  INTEGER NOT NULL,
  dir     INTEGER NOT NULL CHECK (dir IN (0, 1)),
  again_n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (way_id, dir)
) WITHOUT ROWID;

-- Busy times (IDEAS R-36, the owner's Quiet hours decision in docs/OWNER_TODO.md is still open): written ONLY while the
-- server flag `quiet_hours` is on (off by default, backend/src/flags.ts), and read only for roads five or more people drove.
-- bucket: 0..11, weekday (0..5) or weekend (6..11) x six 4-hour blocks of the driver's local time. holders: hmacs, never ids.
CREATE TABLE road_hours (
  way_id INTEGER NOT NULL,
  dir    INTEGER NOT NULL CHECK (dir IN (0, 1)),
  bucket INTEGER NOT NULL CHECK (bucket BETWEEN 0 AND 11),
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (way_id, dir, bucket)
) WITHOUT ROWID;
CREATE TABLE road_hour_holders (
  way_id INTEGER NOT NULL,
  dir    INTEGER NOT NULL,
  holder BLOB NOT NULL,
  PRIMARY KEY (way_id, dir, holder)
) WITHOUT ROWID;

-- The car's fuel and range (car.js): for fuel-stop spacing on long back-road stretches. Optional; unknown asks once.
ALTER TABLE cars ADD COLUMN fuel TEXT CHECK (fuel IN ('petrol','diesel','electric','hybrid'));
ALTER TABLE cars ADD COLUMN range_km INTEGER;

-- Fair meeting points (crew_meet.js): a member's rough home area for one crew, opt-in per crew (off by default), as a
-- 0.1-degree cell centre "lat,lon" (about 11 km, VI-1). Seen by nobody: the server answers only the set of cells, without
-- names, and only once two members of that crew share. Leaving the crew (cascade) or switching it off removes it.
ALTER TABLE crew_members ADD COLUMN home_cell TEXT;
