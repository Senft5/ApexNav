# STATE

## 2026-11-12: Friends on these roads that day, no footnote
- Done: the drive page's "Friends on these roads that day" panel is the list alone. Its footnote ("From the scores friends chose to show you, on stages you both marked. The last 14 days.") is gone: sharing with friends is on by default now, so it read as a privacy caveat that no longer applies, and the heading already says what the list is. e2e flyby flow checks there is no note.
- Next: keep trimming leftover notes on the social screens.

# CALL SHEET

## 2026-11-12: drop the flyby footnote
- What: removed the note under #dvFlyby in web/analysis.html.
- Why: Nate's no-walls-of-text rule; the note described the old opt-in sharing.
- Undo: put the `<p class="note">` back under #dvFlybyList and drop the e2e check.
