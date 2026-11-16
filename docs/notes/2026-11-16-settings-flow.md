# STATE

## 2026-11-16 Settings flow, round switches, the Log's coach card, quiet privacy zones
- Done: on a phone the Garage's Settings is a full page and each setting slides in from the right as the next page ("‹ Settings" back), not a sheet stacked on a sheet. Switches are round pills with a round thumb (off: a quiet well and a grey thumb; on: ink with a paper thumb; the I/O marks stay). A privacy zone is a row (name and size, Remove at the end). On every setting's page a switch is a row on a quiet card and each field (crash contact, age) a full-width well, as grouped rows. The Log opens on one coach card: the latest Score at its top, the news, why, the next thing to work on in a well, and a full-width See the drive; the separate Score hero under it is gone. A privacy zone on the map is a faint tint and a dashed edge that fade as you zoom in, not a brown hatch over your street. Shots: https://claude.ai/artifact/4Uco43XTZbkcWcNUaig7iw.
- Next: the rest of the screen inventory (project files ui-thread/screen-inventory.md), each Settings page's own content (Road feel's summary says Off while "Help improve" is on; the crash contact fields), calm drive step 2.

# CALL SHEET

## 2026-11-16 Settings pages push in from the right on a phone
- What: index.html, under `@media not (desk)`: `#garageSettings` and `.garage-pop` are full-height; a setting's page enters with translateX and the list moves back 28% behind it; large titles; Done top right, "‹ Settings" top left. The desk's side panels are unchanged. garage_settings.js is untouched.
- Why: Nate, 2026-11-16: "Menus just don't feel cohesive like there is a flow when using them. It's always just kind of a list of things". A sheet over a sheet left the list peeking above every setting.
- Undo: delete the "Settings as a flow" media block in web/index.html.

## 2026-11-16 Switches are pills, still with I/O marks
- What: `.sw i` is a 51×31 pill with a 27 px round thumb; off has a dim border, a well fill and an O; on fills with ink, the thumb turns paper and an I shows.
- Why: the square I/O switch read as unfinished next to every phone's own switches; the owner's 2026-10-29 rule (fill, border and mark differ) still holds, and its e2e passes.
- Undo: restore the `.sw i` rules from git.

## 2026-11-16 The Log's coach card holds the latest Score
- What: analysis_page.js renderLogCoach moves `#historyCards` into `#logCoach` while the coach speaks (and back when it is quiet); signature.css styles the card (eyebrow, 72 px Score, the next thing in a well, a full-width ink See the drive). Ids and log_coach.js unchanged (the analysis thread owns the words).
- Why: Nate, 2026-11-16: the Log should "feel more like it's coaching you not just listing data". Two heroes (the coach box, then the Score) read as a list.
- Undo: remove the four lines in renderLogCoach and the log-coach CSS block.

## 2026-11-16 Privacy zones fade as you zoom in
- What: friends_map.js paintZones draws the zone in the look's ink at 0.12 (zoom 10) to 0 (zoom 15) with a 1.5 px dashed edge, in place of the hatch.
- Why: Nate, 2026-11-16: "privacy zones make the map really ugly when it opens zoomed in on your house".
- Undo: restore paintZones from git.
