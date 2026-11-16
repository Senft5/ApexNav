# STATE

## 2026-11-16 The Garage page reads as titled groups
- Done: on the Garage page, Your cars, Look and voice and Co-driver are 22 px group titles. Each control's label (Co-driver's voice, Day or night, The words) is a small-caps line over its control. What else the co-driver does (Notes, Haptics, Key sounds, Soundtrack with its sample, Speak road names) sits on one card of rows, like a Settings page, instead of a run of labels and hairlines. "Hear a sample" hangs under the Soundtrack row instead of standing as its own row.
- Next: one explanation order across Settings pages; the screen inventory (project files ui-thread/screen-inventory.md).

# CALL SHEET

## 2026-11-16 Feedback's switches on one card, Send across the page
- What: feedback.js: a switch's name is short ("Attach diagnostics", "I'd like a reply") with what it sends as a small line under it, still on the row (U-135); the two sit in `.fb-switches`, one card. Send is full width.
- Why: the labels were one long sentence in brackets and Send a small pill at the foot of the page.
- Undo: revert feedback.js and the "Feedback:" CSS block.

## 2026-11-16 One label style over a setting's controls; Account's keys as rows
- What: Privacy zones' "Size of a new zone", Units' "Driving side" and Spots' "How far loops go out of their way" get `group-label` (the small caps line "Take a copy" already used). On Account, Download my data and Sign out are rows on one card and Delete account sits on its own card, in red, as Your data's rows are. CSS only, scoped to `.garage-pop`.
- Why: the same Settings pages mixed grey sentences and small caps as labels, and Account was the one page of loose pills.
- Undo: remove the two CSS blocks above `.garage-pop .sw` and the `group-label` classes.

## 2026-11-16 Co-driver's rows on one card
- What: index.html wraps #coNotesHere, the switches, #soundtrackRow and #liveVoiceBtn in `<div class="co-card">`, and adds a CSS block above `.garage-pop .sw` (group titles, small-caps control labels, the card). No ids changed, no JS.
- Why: Nate, 2026-11-16: menus are "always just kind of a list of things"; the Garage's own page was the last one still built from loose rows after the Settings pages became grouped cards (#1001).
- Undo: drop the wrapper div and the "The Garage's own page" CSS block.
