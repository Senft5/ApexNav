# STATE

## The Log's coach names the corners you beat (2026-11-16)
- On a usual Score, the Log's brief (web/log_coach.js) now leads with the latest drive's corners quicker than every
  earlier pass: "Three corners quicker than ever · Most at corner 15 (Careful, square right): 0.9 s under your
  best pass before." go is { drive, cornerIndex }. A best, cleaner or rougher drive is still the bigger news.
- The worker job `cornerNews({ id })` (analysis_client.js) gives { driveId, bests: [{ k, by_s, corner }] } from
  drive_view.js newBests over the drive's coach; the page names each corner in the driver's words (cornerCall).
- Fixed a wrong "best yet" (validated on Nate's drive of Nov 14, 22:58): newBests compared only with passes inside the
  grip ceiling (prior_s), so corner 22 was called a best by 0.9 s though the 21:35 drive took it 0.5 s quicker, over the
  ceiling. It now needs this drive quicker than every other pass (Core.coach times), and says the margin to the quickest.
  The drive page's "Your best yet" list reads the same function.
- Tests: tests/test_log_coach.py (corner news, one corner, another drive's news, a best drive outranks it),
  tests/test_new_bests.py (a quicker pass over the ceiling is not beaten).
- Next: open the drive at that corner from the Log (go.cornerIndex); the redesign thread owns the card.
- Wording (asked by the redesign thread, whose Log card shows the latest Score and its day right above the brief): no
  day in the headline, no Score at the head of why ("40 above your previous best", "Close to your usual 650").
