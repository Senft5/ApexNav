# Vetta Line: the signature language

One language for every screen, so the app reads as one made thing. web/signature.css carries the shared parts.

1. **The map is the page; chrome is paper laid on it.** Paper lifts on a soft warm shadow (`--lift-0/1/2`), not a 1.5 px
   ink box. Corners stay square (print, not pills). Hierarchy comes from weight and space.
2. **One ink key and at most one red thing per screen.** Red (`--accent`) means go, record or act now.
3. **The pen.** Things arrive by being drawn: lines draw on, numbers count up, sheets rise on `--arrive`
   (`cubic-bezier(0.2, 0.8, 0.2, 1)`). 120 ms press, 220 ms sheet, 600 to 900 ms a line, 1400 ms at most a set piece.
   Reduced motion: a cut, nothing left half drawn.
4. **Type.** Barlow Condensed for what is read at a glance (numbers, titles, calls); Inter Tight for sentences.
   34 / 26 / 20 / 17 / 15 / 13, nothing smaller.
5. **The apex dot.** The mark's red dot means you, now, go: the open tab, Just drive, the masthead's live line.
6. **Quiet rows.** Hairline-divided rows, the action a word in ink.
7. **Driving first.** Glanceable at arm's length, 44 pt targets (52 for the main key), no motion while the car moves
   except at start, end and a new call.
