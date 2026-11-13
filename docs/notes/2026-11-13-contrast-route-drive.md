# STATE
## Session 2026-11-13 (contrast in every look, part 2): the route card and the drive screen (claude/project-thread-dpdmcn)
- Done: two e2e flows hold the route card (and its Saved key pressed) and the demo replay's drive screen to the contrast floor in Roadbook, Tapedeck and Billet, day and night, each look on a clean phone (its own browser context). Both pass today; with the #677 Saved bug put back, the card flow names it in all six looks. Weights for the three sweep flows added to the shard table.
- Fixed: the drive page's "Clip this corner" key (big bet 5) was cream on cream, 1.11:1: signature.css gave every button in a corner's time row the card's face, the solid key too. The rule now skips `.solid`. The contrast floor caught it on main's "side by side" flow.
- Next: the private themes (Tiburon, FR-S) and the accents are still outside the sweep; SVG text (the dials' numerals) is left to tools/contrast_dump.js.
