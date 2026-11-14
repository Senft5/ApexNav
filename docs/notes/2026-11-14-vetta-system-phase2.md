# STATE

## 2026-11-14: the main look, phase 2: one shared stylesheet, the drive strip, the Log, launch
- The design system now lives in its own file, `web/system.css`. The map page and the Log (analysis.html) both load it last, so the Log gets the same rounded keys, raised cards and hair rules. Before, it lived in index.html's inline style and the Log never saw it.
- Drive strip, the main look only:
  - The road you turn onto is 16 px in sentence case (it was 11 px caps).
  - The call is 28 px.
  - The divider between now and next is the hair.
- Log, first page: the pencil drawing of a first drive is a raised card with rounded placeholders. The index rows are ruled by the hair, not ink.
- Launch and the shell behind the web view: #111214, the new night panel (Assets LaunchBackground, ApexNavApp.swift `launchPanel`, index.html's first paint, analysis.html #boot). Was #151310.
- Privacy, terms and licences (web/legal.css) use the new day and night tokens.
- Newly possible: a screen in either page picks up the main look by component kind. The road name of a turn reads at arm's length.
- Next: type-scale tokens; the feed card's map at night (Social's); a bolder binnacle.

# CALL SHEET

## 2026-11-14: system.css loads last, after signature.css
- What: `web/system.css` comes after controls.css and signature.css on both pages.
- Why: its rules are the main look's and must outrank the per-screen ones, which are all scoped flat for other themes anyway.
- Undo: move the link before signature.css, or fold the file back into index.html's style.
