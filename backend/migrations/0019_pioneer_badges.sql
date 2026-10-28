-- Pioneer badges (IDEAS S-09): how many road+directions this member was first (3x points) or second (2x) to map. Counted when
-- the slot is claimed (contribute.ts), so the count survives the slot's user_id being cleared once it freezes. Shown only to
-- the member themselves: who was first on a road is never exposed.
ALTER TABLE members ADD COLUMN pioneer_firsts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN pioneer_seconds INTEGER NOT NULL DEFAULT 0;
