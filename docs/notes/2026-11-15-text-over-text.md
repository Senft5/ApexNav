# STATE
## Session 2026-11-15 (text over text): every flow's last screen, and the large text sweep, check that no words are drawn over others (claude/project-thread-dpdmcn)
- Done: `overlappingText` in e2e/smoke.js runs on every flow's last screen, after the cut-text check. It fails when two lines of words from different boxes cross: by more than 3 px across and a third of the smaller line's height. Both must show: nothing opaque lies between the lower line and the eye. Text in a hidden, inert, see-through or transparent box doesn't count, and neither do the map's own markers.
- It measures the ink, not the line box. A display numeral's line box is mostly air (the Log's 836, the end card's score, the ETA page's 14), and the first survey flagged 27 false hits from that air. With ink boxes from `measureText`, the whole suite (307 flows) finds none at 1x.
- The large text sweep checks it at 1.5x and 2x too, and finds none. An injected overlap (the Log's caption pulled up 50 px) is caught.
- `OVERLAP_LOG=1` lists the hits instead of failing.
- Tests: full e2e locally with `OVERLAP_LOG=1` (no hits, all flows pass).
- Next: another roam item.

## 2026-11-15 the narrowest phone and a phone on its side get the same sweep
- What: the large text sweep's screens moved into `screensSweep(page, base, shapes)`. A new flow reads them on a 320 pt phone (an iPhone SE or mini with Display Zoom on) at 1x and 2x text, and on a phone on its side (844 x 390).
- Why: at 320 pt and 2x the Log ran off the phone. The empty page's three score boxes and "/1000" were 31 px too wide, and with drives the hero's "mi" ran 9 px off.
- Fix: the boxes may shrink (`min-width: 0`), and at large text the hero's unit wraps under its figure (`flex-wrap`). Undo: delete the two rules in analysis.html (the new flow names the cut again).
- The text-over-text check also cuts each line to its boxes' overflow, so an ellipsis's hidden tail isn't counted ("Loop from here · 45 mi" under Plan).

# CALL SHEET
## 2026-11-15 the text-over-text check uses glyph ink, from the canvas's text metrics
- What: each text run's box is cut to the font's actual ascent and descent above and below its baseline (`actualBoundingBoxAscent/Descent`, the baseline from `fontBoundingBoxDescent`).
- Why: line boxes of big display numerals overlap their captions with no ink touching. That gave 27 hits, none visible.
- Undo: use `range.getClientRects()` as is (and expect those false hits back).
