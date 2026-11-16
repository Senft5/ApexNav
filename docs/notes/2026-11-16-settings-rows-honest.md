# STATE

## 2026-11-16 A Settings row reads every switch its page names
- Done: the Road feel row in the Garage's Settings read only the first switch (Share road feel), so it said Off while Help improve Vetta roads was on, and it never looked at Help improve at all. A row whose page names several switches now says On, Off, or "1 of 2 on". Signed out, Road feel reads "1 of 2 on" (sharing needs an account; the anonymous copy is on by default).
- Next: Look and voice and Co-driver pages; one explanation order across Settings pages (project files ui-thread/screen-inventory.md).

# CALL SHEET

## 2026-11-16 Road feel's row counts its two switches
- What: garage_settings.js `summaryOf` takes the list of nodes a section's `data-summary` matches; several switches read as On / Off / "k of n on". Road feel's `data-summary` adds `[data-toggle=improve]`. The signed-out e2e expects "1 of 2 on", then Off after Help improve is turned off.
- Why: Nate, 2026-11-16, asked for the deeper menus to get attention to detail; a row that says Off while a switch on its page is on is a small lie.
- Undo: revert the commit; the row goes back to reading the first match.
