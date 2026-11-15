# STATE

## Old builds' camber is unknown on the phone too (2026-11-15)
- Found on the owner's 13 drives (all recorded before camber v3): the old live pipeline's camber, which is the attitude
  filter's drift and not the road's bank, tagged 75 of 245 corners "banked" or "off-camber" and moved each drive's Score by
  up to 11 points either way (the corner limit leans on tan of the bank: −9, +2, −3, +1, +8, −7, +3, −2, +11, +7, −11).
  The server already refused it (CAM_V 3); the phone's own analysis still read it.
- Fix, web/recording.js: `parse` keeps camber only from a file whose camber_v is 3 throughout, and profiles the corners
  without it otherwise (every bin null, unknown). `repair` profiles a saved record with old camber again without it
  (`staleCamber`: cam_v not 3 and some camber finite), once. SUMMARY_VERSION 4: a Log summary from before is scored
  again only for a drive with old camber; one without keeps its score (the cheap upgrade, now for versions 2 and 3).
- On the owner's drives: 0 corners read banked or off-camber, the corner calls and limits come from the road's shape alone.
  Drives from a v3 build keep their measured camber.
- Tests: tests/test_old_camber.py (a 6° bend: kept and "banked" with camber_v 3; unknown, no "banked", the camber-free
  limit and Score from a file without it or with 2, and from a saved record); e2e "the Log list" checks a version-3
  summary of a drive with old camber is scored again.
- Checked with no change: live "Brake later" (pass_coach.js) never fires on the owner's drives (most have no clock).
- Next: per-corner road feel from v3 drives once the owner has some (a v3 TestFlight build).

# CALL SHEET

## Old camber is dropped on the phone, not only on the server (2026-11-15)
- What: camber from builds before camber v3 is treated as unknown in the drive's own analysis: corner mods, corner
  limits, the Score, the road-feel lane.
- Why: it is attitude drift (docs/notes/2026-11-15-camber-specific-force.md), a validated measurement error; it shifted
  Scores both ways, so this is no flattery.
- How to undo: remove `staleCamber` from `repair` and the `camV === CAM_V` gate in `parse` (web/recording.js), and set
  SUMMARY_VERSION back to 3.
