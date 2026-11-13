# STATE

## 2026-11-13 A level corner pref leans with your taste (claude/project-thread-39xbx9)
- IDEAS R-19 said "sliders first, learned later"; R-33 learns TECH vs FLOW from "which road was better?" answers and
  picks but only nudged the top four routes by up to 8 fun points after the search.
- `taste.js` `cornerLean(t, prefs)`: a Hairpins or Sweepers pref left level gets a tilt of 1.25 x (tech - flow),
  at most ±0.5 of a step, toward tight corners and away from fast ones for a technical taste, the other way for a
  flowing one. A pref you set wins; under five answers or an even taste nothing changes.
- cockpit.js `searchPrefs()` sends it to our router's plans, through-routes, round trips, loops and Best roads nearby,
  and to the map's stage search; `apexDebug.lastSearchPrefs` shows it. Route scores and the card keep your own prefs.
  Off with the `taste_ranking` flag, like the taste bonus.
- Tests: `test_taste.py` (lean, a set pref wins, none, even, the cap, and the cockpit's calls).

# CALL SHEET

## 2026-11-13 Your taste steers the search, softly (claude/project-thread-39xbx9)

Half a step at most (±30 % per edge at the cap) so a learned lean never outweighs a pref you set (±60 %), and only
the search and stage lists lean, not the route score, so the taste bonus is not counted twice. Undo: return
`roadPrefs` from `searchPrefs`.
