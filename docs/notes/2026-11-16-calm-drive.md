# STATE

## 2026-11-16 A calm drive screen, step 1
- Done: upright in a drive the panel is one row: the speed, the limit (when known), Sight only while you are over it (its plate rides the map), the time left on a route, Report as a hazard glyph, and End. The G-ball, the 0–140 ruler and the trip ledger come back with a tap on the speed (`#app.drive-more`), and a tap again tucks them away; each drive starts calm. The status line's news (a report sent, weak GPS, calibrating) is a slip over the map's foot. In a convoy, the drive's line is a pill of friends' faces with "Convoy"; the names and count stay for VoiceOver, and the status words show while it isn't live. Mockup and shots: https://claude.ai/artifact/4Uco43XTZbkcWcNUaig7iw. Inventory: project files ui-thread/screen-inventory.md.
- Next: step 2 of the drive (the explain card and the Report sheet in the same calm style, landscape); the Log as a coach (the analysis thread's #logCoach, PR #990); privacy zones on the map; then the inventory, item by item.

# CALL SHEET

## 2026-11-16 The drive panel shows only what matters at speed
- What: in `#app.live` upright (not replay, not `.drive-more`), index.html hides the G-ball, the speed ruler, the ledger and Sight (unless over it), shows only the time-left figure on a route, and draws Report as a glyph with its label kept for VoiceOver. A tap on the speed toggles `.drive-more` (cockpit.js, in the cluster's tap handler, in place of the speed's explain card while driving). The Vetta Line e2e checks the calm row first, then taps for the full panel.
- Why: Nate, 2026-11-16: "The screen is cluttered in general while driving" and the convoy clutters it. Apple Maps' driving view shows the next turn, the map and a single bottom card.
- Undo: delete the "A calm drive" block in web/index.html and the `drive-more` lines in cockpit.js; the old panel returns unchanged.

## 2026-11-16 The calm row is the Vetta Line's only; the speed gives way to the time left
- What: every calm rule is scoped `#app.live…:has(#cluster.cluster-line)`, and the speed tap opens the panel only on that cluster. The row is `minmax(0, auto) max-content`: the bar (time left, Report, End) takes what it needs and the speed dial (126 px, `max-width: 100%`) gives way, so "~1:30 hr" stays whole even on a 320 px phone (the numeral 87 px at 390, 64 px at 320 with "5 min").
- Why: CI's U-99 flow caught the time left squeezed to nothing at 320 and 375 px, and Tapedeck's and Billet's dials (a different cluster) overprinted under the line cluster's rules.
- Also: #929's "no limit sign when the limit is unknown" never won over the sign's own rule (`html .readouts .ro.ro-limit`, more specific), so an empty sign still showed; the rule now matches it, and the Vetta Line e2e checks it.
- Undo: drop the `:has(...)` from the selectors (only if the dials get their own calm layout), and set the binnacle back to `auto minmax(0, 1fr)`.

## 2026-11-16 Convoy in a drive is a chip of faces
- What: convoy_ui.js adds `.cv-faces` (up to three initials, then +n) to the drive's line and clips the name and count visually while live.
- Why: the long "@nate and @bob · 2 of 2 live" line was the clutter Nate named.
- Undo: remove the `.cv-faces` lines in paintBar and the calm block in the CSS string.
