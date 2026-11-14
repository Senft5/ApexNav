# STATE
## Session 2026-11-14 (copy truth): privacy and speed wording brought up to date (claude/project-thread-kh1ljp)
- Done: the "No top speeds" promise is gone from the site (web/about.html), the in-app About (web/index.html) and the
  Log's challenges note; "Clean beats fast" is "Quick and clean" with live gaps; the promises are Shared with your
  people, Home stays home, Unknown stays unknown, Free to drive. Privacy lede is no longer privacy-first; its time attack
  section now describes the fixed season loops (ta_fixed: boards by week/month/year/season, kept two years). Terms say
  times, gaps, time attacks and coaching are never races. LISTING.md, the marketing drafts, PHILOSOPHY and APP_REVIEW
  1.4 no longer claim there are no time boards.
- Kept on purpose: per-feature facts that are true and short ("Videos stay on this phone", the road data switch's
  "Never where you went or how fast", "Your drive stays on this phone" on the permission sheet).
- Next: none in this area. tests/test_promises_current.py now fails on any of the old promises coming back.

# CALL SHEET
## 2026-11-14 (copy truth): dropped "not a racing app" from the site, kept the listing free of time attack (claude/project-thread-kh1ljp)
With time attack boards and live time gaps, "not a racing app" read as false; the site now says "Public roads: always
drive within the law and the conditions", and the terms carry the stronger line (times and boards are never races).
The App Store listing still names no time attack and none of test_listing.py's banned words (APP_REVIEW 1.4 time attack
row), but now says Scores and stage times go to friends and crews. Undo: revert web/about.html's fine print and terms.html.
