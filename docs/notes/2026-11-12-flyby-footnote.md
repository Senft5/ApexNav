# STATE

## 2026-11-12: Friends on these roads that day, no footnote
- Done: the drive page's "Friends on these roads that day" panel is the list alone. Its footnote ("From the scores friends chose to show you, on stages you both marked. The last 14 days.") is gone: sharing with friends is on by default now, so it read as a privacy caveat that no longer applies, and the heading already says what the list is. e2e flyby flow checks there is no note.
- Next: keep trimming leftover notes on the social screens.

# CALL SHEET

## 2026-11-12: drop the flyby footnote
- What: removed the note under #dvFlyby in web/analysis.html.
- Why: Nate's no-walls-of-text rule; the note described the old opt-in sharing.
- Undo: put the `<p class="note">` back under #dvFlybyList and drop the e2e check.

## 2026-11-13: the sight-line e2e reads the tag and the cell together
- What: the "sight-line speed rides under the position arrow" flow now waits, for up to 8 s, until the Sight tag's number shows in the cluster, and reads both in one snapshot.
- Why: it failed twice in CI (the second time on this PR) with tag SIGHT15 and a cell that had already moved on. Playback runs while the test reads, and the tag holds a value for 2 s (U-60) while the cell updates at once, so two separate reads could straddle a change. If they never agree, the check still fails.
- Undo: go back to the two `page.textContent` reads.
