# STATE

## 2026-11-13 The corner prefs pick Best roads nearby and a loop's stages too (claude/project-thread-39xbx9)
- After #624 the prefs steered a trip's search, but our tiles' Best roads nearby (`graph_router.js` `explore`) ranked
  roads by quality x corners alone, and loops are built from explore's best roads, so a loop's stages ignored them.
- `likeOf(v, prefs)`: the per-edge factor #624 put in the objective, now shared; `explore` scores each edge by it
  (req.prefs), `loopCombos` passes the loop's prefs, and cockpit.js's Best roads nearby sends `roadPrefs`.
- On the bundled tiles: a 40 km Fun loop from downtown Cincinnati with "more hairpins, fewer sweepers" adds a Nine Mile
  Road loop; a 60 km Long way loop drops the Jordan Road ones (sweepers) for the rest.
- Tests: `test_graph_router.py` cornerPrefs (explore ranks the asked-for road first, either way round).
- Next: the map's own stage search (stages.js, highlights on) still ranks without the prefs.

# CALL SHEET

## 2026-11-13 Explore and loop stages weighed by the corner prefs (claude/project-thread-39xbx9)

The same ±60 % per edge as the search, so a driver who asked for hairpins gets hairpin roads offered, not only routed
over. With no pref, nothing changes. Undo: drop `likeAt` from explore's score.
