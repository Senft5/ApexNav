# STATE

## The deer-at-dusk e2e flow no longer races its last fix (2026-11-14)
- Cause: at 20 m/s the deer call's lead is the last two or three fixes of the drive loop, and the flow checked what was
  said right after the last one, before the page had read it (nothing spoken and nothing marked spoken: `at dusk: []`,
  2 in 6 locally on main).
- Fix (e2e only): after the loop the car holds 20 m before the sign, a fix every 100 ms, for up to 2 s, before the check;
  at noon the full 2 s pass and nothing may be said. 16/16 locally (8 at dusk, 8 at noon).
- Next: keep roaming.
