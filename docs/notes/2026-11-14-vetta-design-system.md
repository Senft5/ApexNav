# STATE

## 2026-11-14: the main theme redesigned as one system (phase 1)
- Why: Nate (2026-11-14) said Roadbook was "flat, boring, uninspired and low contrast", tuned screen by screen. He doesn't want a main theme that keeps being tweaked.
- Colour (web/themes.js, id still `roadbook`, now shown as **Vetta**): graphite and white with one red, dark-first.
  - Night: #0A0A0B / #111214, raised #1B1C20, ink #F5F5F7, red #FF3341.
  - Day: white panel on #F4F5F7, ink #0B0B0C, red #E0102A.
  - New map palette: cool greys, white roads with soft grey casings (the black casings are gone), blue water, green parks. The night map is graphite.
- Shape and depth are tokens (web/index.html, the "THE VETTA DESIGN SYSTEM" block): `--r-key` 12, `--r-card` 16, `--r-sheet` 22, `--elev-1`, `--elev-2`. They're applied by component kind:
  - Keys, fields, switches and chips are rounded.
  - Outline keys become raised fills.
  - Cards sit on `--raised` with no outline.
  - Sheets have rounded top corners and lift off the map with a shadow instead of a rule.
  - Map keys float.
  - Other themes keep their own look: the tokens default flat.
- CarPlay's cold-start palette (CarPlay/ApexCarMap.swift) matches the new map. docs/BRAND.md has the new box at the top.
- Newly possible: one place to change the main look (tokens), and every screen picks it up. The map reads in direct sun without black outlines on every road.
- Before/after: /mnt/project-files/ui-thread/theme-before-after-day.png and -night.png.
- Next (phase 2): a bolder drive screen (the notes strip and the binnacle as layered surfaces), type scale tokens, the Log's empty state, the feed card's map at night, the launch screen colour (#151310 in Assets and index.html's first paint).

# CALL SHEET

## 2026-11-14: Roadbook's look replaced in place, its id kept
- What: the `roadbook` theme's tokens and label change ("Vetta"). The id stays, so saved choices, the CarPlay look message and tests keep working.
- Why: Nate asked for a ground-up redesign of the main theme. Keeping the id avoids migrating every phone's saved theme.
- Undo: revert web/themes.js `roadbook` day/night/map and the design-system block in web/index.html.

## 2026-11-14: the route stays ink, red stays "act now"
- What: no coloured route. The route is black by day and white by night; red is the record key, the apex, warnings and selected marks.
- Why: the theme contract (theme_contract.js APART) and the panel round 2 decision keep the route apart from the warning colour. The contrast now comes from the map, which no longer draws every road in ink.
- Undo: set `route` in themes.js. A colour at least 90 apart from `signal` passes the contract.
