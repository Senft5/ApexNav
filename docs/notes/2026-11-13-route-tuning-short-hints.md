# STATE

## 2026-11-13 Route tuning: one short line under each slider

- **Done:** Garage → Settings → Route tuning had a three-line intro and a two-line hint under every one of its 14 sliders.
  - The intro now reads "Changes routes to a place and loops. Not a loop's length, nor Best roads nearby."
  - Each hint is one short line, at most 64 characters, for example "How much bends count."
  - tests/test_route_tuning.py holds the hints to 64 characters. It fails on main.
- **Done:** the e2e Layers legend check in "REVIEW.md 1.2 screen by screen: first run…" now waits for the panel's slide
  to finish. Before, it read the panel at a fixed 400 ms. On a busy CI runner it caught the 120 ms slide 4 px short
  (box right 394 on a 390 screen) and failed on this PR's first run.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-13 Route tuning hints cut to a line each

- **What:**
  - The text of `hint` on every slider in web/route_tuning.js is shortened, and so is `AFFECTS`.
  - The finer points the hints dropped are not lost: the code comments still say them. They cover a few minutes of
    slack on short trips, that lights count only their real wait in the ETA, and that highways are never driven.
- **Why:** Nate's standing UX rule bans walls of text. That screen was mostly grey paragraphs.
- **Undo:** revert web/route_tuning.js, and set the test's 64 back to 120.
