# STATE

## "School zone" on a free drive too (V-13, 2026-11-15)
- `cockpit.js attachHorizonMarks`: the road ahead asks `events` beside `osm_overpass`, with `placesOnly`, so the schools
  by the road (our weekly built points, else Overpass, cached per tile a week) become School zone marks there as on a
  planned route; still said only in a school run (`allEvents`, `schoolRunAt`).
- `web/route_ctx/events.js`: `placesOnly` skips the MLB and SeatGeek calls (a free drive has no use for the games on it).
- Tests: `tests/test_route_ctx_events.py` (placesOnly: no schedule call, the school found); the e2e "a school zone by the
  road…" flows now get the school from a stubbed places answer instead of a hand-laid mark (they fail with the horizon
  asking `osm_overpass` alone).

# CALL SHEET

## The events provider no longer needs a SeatGeek id to run (2026-11-15)
- What: `events.js` dropped `needs.key: 'seatgeekClientId'`. The registry skipped the whole provider ('no-key') without
  it, so baseball traffic, church hours, school runs and the schools by the road were all unknown on any phone without
  the id, though none of them needs it (the file's own header says MLB works without a key). `fetch` already asks
  SeatGeek only with an id and notes when it is missing.
- Why: the Worker's `CTX_KEYS` id is currently refused by SeatGeek (OWNER_TODO), and offline or signed out the keys may not
  load; the keyless parts should not depend on it.
- Undo: put `key: 'seatgeekClientId'` back in the provider's `needs` (and `tests/test_route_ctx_fetch.py`).
