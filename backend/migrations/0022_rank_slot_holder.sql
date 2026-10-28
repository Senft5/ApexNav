-- One person holds at most one slot per road+direction (review 2026-10-28): two of their own uploads racing could claim
-- both and meet the two-driver rule of GET /api/roads (IDEAS Z-08) alone. Checked: no such pair existed when added.
CREATE UNIQUE INDEX rank_slots_holder ON rank_slots (way_id, dir, holder);
