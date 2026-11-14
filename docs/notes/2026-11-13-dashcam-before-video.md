# STATE

## 2026-11-13 Dashcam overlay: a line and Pick a video until a video opens

- **Done:** before any video, a drive page's Dashcam overlay section showed a lot with nothing to act on. It had a
  three-line paragraph of steps, the Earlier/Later slider, the − 0.5 s and + 0.5 s nudges, "Video starts 0 s into the
  drive" and a disabled Make the video.
  - It now shows one line ("Your speed, g and calls on a video you filmed on this drive. It stays on this phone.") and
    the Pick a video key.
  - The line-up controls appear with the video. The line under the picture already says what to do ("Slide until the
    car is at this corner").
  - The e2e flow "dashcam overlay" checks the bare state. It fails on main.
- **Done:** the e2e flow "People: Return on the keyboard…" failed once on this PR's CI. Its stub answered each save after
  a fixed 400 ms, and a slow runner's second Return came after that, when the form had re-rendered ("element was
  detached"). The stub now holds each save until both Returns are in.
- **Done:** the e2e flow "valhalla down: planning inside our tiles…" failed on this PR's CI at 1511 ms against a 1.5 s
  budget for a loop. The loop takes 1.2 to 1.5 s locally on main and on a commit from before today's routing PRs, so
  nothing got slower: the budget had no room. It is 2 s now, still under the shortest Valhalla wait (OWN_CHECK_MS, 2.5 s).
- **Done:** the e2e flow "a saved route keeps its reports…" failed on this PR's CI with "ApexRowSelect is not defined".
  The Log loaded with no signal, row_select.js had not been kept by the browser, and analysis_page.js called it bare, so
  the whole Log page died. Every other caller already checks `root.ApexRowSelect` first. analysis_page.js now does too,
  and the Log keeps the plain select. Checked by loading analysis.html with row_select.js blocked: no page error.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-13 Dashcam line-up controls wait for a video

- **What:** dashcam.js wraps the balance slider, the nudges, the offset line and Make the video in `.dc-lineup`. That
  block is hidden until `ready()`, hidden again by `openSrc()`, and hidden on a video error.
- **Why:** Nate's standing UX rule asks for clean, intuitive screens, so nothing should show before it can be used.
- **Undo:** append `balance, fine, offsetNote, exportBtn` straight to `box` again, and restore the old note text.

## 2026-11-14 The Valhalla-down loop budget is 2 s

- **What:** e2e/smoke.js "valhalla down: planning inside our tiles…" allows a loop 2 s instead of 1.5 s.
- **Why:** the loop alone takes 1.2 to 1.5 s, and a busy CI runner went 11 ms over. A loop that waited on a hanging
  Valhalla would take at least 2.5 s (OWN_CHECK_MS), or 20 s for map matching, so 2 s still catches that.
- **Undo:** set `loopMs <= 2000` back to 1500.
