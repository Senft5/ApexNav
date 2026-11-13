# STATE

## 2026-11-13 Best roads nearby with highlights: drive times from our tiles (claude/project-thread-39xbx9)
- With highlights on (or no road from our tiles' own search), Best roads nearby uses the map's stage search, and timed
  the drive to each stage's ends with Valhalla's matrix. Where our tiles cover you, `graph_router.js` `times` (host
  type 'times', the same reach as explore) now times them on the phone; Valhalla's matrix only where they don't, or on
  a failure, as before. `apexDebug.lastExploreTimes` says which ('own stages', 'own', 'matrix').
- IDEAS R-03 marked done: our router's search has taken members' roughness, banking, flow, crests and verified bumps
  per edge for a while (crowdOnto, objectiveOf).
- Tests: `test_graph_router.py` times case and a source check on cockpit.js `ownTimes`.
- Next: no e2e yet for Explore with highlights (it needs the map's vector tiles stubbed).

# CALL SHEET

## 2026-11-13 Reach times, not routed times, for the map's stages on our tiles (claude/project-thread-39xbx9)

The reach has no turn costs, so a time can read a little shorter than a route's (our own stages are timed the same
way already). It is a "how far away" figure on a list, not an arrival time. Undo: drop `ownTimes` in exploreNear.
