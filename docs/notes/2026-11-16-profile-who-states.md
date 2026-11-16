# STATE

## 2026-11-16: friend profile and Who sees what: shared states
- A friend's profile opens at once with its head (face, @handle, dashed Days/Stages/Best) while it loads; before, the tap did nothing until the answer came.
- When the profile can't load, "Couldn’t load the rest. Check signal." now has Try again.
- Who sees what shows a skeleton of rows instead of a "Loading…" line.
- Tests: tests/test_profile_who_states.py; e2e "friend profile:" and "People: two tabs" wait past the skeleton (`.profile-view:not(.skel)`).
- Next: keep sweeping the Social sheets in /mnt/project-files/social/screen-inventory.md.

# CALL SHEET

## 2026-11-16: a redraw of an open profile keeps it as it is
- What: the skeleton draws only when the profile isn't already open for that friend.
- Why: People redraws when presence or a grant changes, and a flash back to the skeleton each time would look broken.
- Undo: drop the `shown` check in openProfile (web/cockpit.js).
