# STATE
## Session 2026-11-12 (social declutter, part two): the crew page is three tabs (claude/project-thread-uwmi4e)
- Done: under the crew's name, Drives (upcoming drives, members, pinned route, meeting points), Chat and Board (the Vetta Score board, the house stage, builds) are ARIA tabs with the People tabs' look; Drives opens first; the pick is kept per crew while the app runs; arrow keys move between them. The livery stays one line at the foot of every tab.
- Next: the For you list on People; Crew settings' long "Who can find it" paragraph (cockpit.js crew settings).

# CALL SHEET
## 2026-11-12 (crew page tabs): Drives, Chat, Board instead of one long page (claude/project-thread-uwmi4e)
Nate: "Social features should feel just as easy to use as any major social media app." A club page in those apps is a header and tabs, not every part stacked. Meeting points sit under Drives (they pick a drive's meeting point). The chosen tab isn't saved on the phone: a fresh start opens on Drives. Undo: revert this PR (crew_page.js view() put the parts back in one cp-body).
