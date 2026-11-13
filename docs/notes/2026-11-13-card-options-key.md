# STATE

## 2026-11-13 say it once: the card's Options key and Road feel's off line (claude/project-thread-5sbga7)
- Done: under "Planned with", the route card showed "Options · 1 on" beside the "× Unpaved" chip that already names that one option; the card's key now reads "Options" (Where to? keeps "Options · N on", with no chips beside it). Garage → Road feel said "Off. Turn on Share road feel above." under the switch that already shows Off; a member with the switch off now gets no line (the empty line is hidden). Signed out still reads "Off. Sign in to share road feel." (U-116: never "sign in" to a member).
- Tests: e2e "plan flow (d)" checks the card's key; "REVIEW5 §2" checks Road feel's empty line; tests/test_garage_settings.py updated.
- Next: keep sweeping the Garage (each car card stacks two big buttons, Add a cover photo and Start a build thread).

# CALL SHEET

## 2026-11-13 no count on the card's Options key; no Off line under an Off switch
- What: cockpit.js paints cardOptionsChip as 'Options'; paintAmbient's member-off line is ''; index.html hides #ambientNote when empty.
- Why: say a thing once (UI guide): the chips name the options, the switch says Off.
- Undo: chipLabel(on) for both chips; restore 'Off. Turn on Share road feel above.'.
