# STATE

## 2026-11-13 The corner prefs rank the map's own stages too (claude/project-thread-39xbx9)
- After #654 our tiles' Best roads nearby followed the prefs, but with highlights on (or no tiles there) the map's
  own stage search (`stages.js` `bestWindow`) still credited each corner by its severity alone.
- `prefLike(sev, prefs)`: hairpins, 1s and 2s count ±60 % for Hairpins more/fewer, 5s and 6s for Sweepers, the same
  split and step as `fun_route.js` `cornerWeight`. `discover` passes `opts.prefs`; `discoverKey` keys kept answers by
  them; cockpit.js's Best roads nearby sends `roadPrefs`. The map's twisty-roads layer stays without them.
- Tests: `test_stages.py` corner prefs (a road of 2s beats a road of 5s; asked for sweepers, not hairpins, it flips).

# CALL SHEET

## 2026-11-13 The map's stages weighed by the corner prefs (claude/project-thread-39xbx9)

Same ±60 % as the route score and our router's search, so the two stage sources agree. The twisty-roads map layer is
general road knowledge, so it ignores the prefs. No pref: identical scores. Undo: drop `prefLike` from `bestWindow`.
