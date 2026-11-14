# STATE
## Session 2026-11-14 (large text sweep): the main screens at 1.5x and 2x text cut nothing (claude/project-thread-dpdmcn)
- Done: a new e2e flow, "large text on every screen", reads the welcome, the idle map, a planned route's card, People, the Garage and the Log at the phone's 1.5x and largest (2x) text sizes. It fails on cut text (`clippedText`), keys under 24 px (`smallTargets`), or a page wider than the phone. `CLIP_LOG=1` lists the hits instead of failing. `clippedText` no longer treats the page itself (html, body) as a sideways scroller, so text pushed off a page that can scroll sideways now counts.
- Fixed, found by the sweep: at large text the empty Log was wider than the phone (8 px at 1.5x, 32 px at 2x). "Your first drive goes here." and its Start a drive key ran off the right edge. Three causes:
  - the first page's grid sized itself to the pencil drawing's index row;
  - the head's full-bleed margins grew with the zoom;
  - the head (Drives, Stages) grew at the full scale.
  The grid is now `minmax(0, 1fr)`. At large text the drawing keeps only its score boxes. The head grows to the fit scale (1.6x at most), and its margins are divided by it.
- Tests: full e2e locally (two shards at a time; "saved for offline" failed under that load and passes alone); pytest.
- Next: the drive screen and a drive's page in the large-text sweep.

# CALL SHEET
## 2026-11-14 the Log's head grows to the fit scale, not the full one
- What: analysis.html `#tab-history > .log-head …, #tab-segments > .log-head.bar-top { zoom: var(--type-scale-fit) }`, its inline margin and padding divided by the same.
- Why: Drives and Stages are already display-sized type; at 2x the head alone was wider than a phone.
- Undo: delete the rule (and the large text sweep will name the cut again).
