# STATE

## Session 2026-11-12 (carplay notice): a request from the car that fails says why on the car (claude/project-thread-me97iw)
- A loop or a place to go asked on the car that couldn't be planned, or a report with no GPS fix, used to leave the car silent: the reason was a phone toast. Now, while such a request runs (`carAsked` in web/cockpit.js), `toast()` also posts `{kind:'notice', titles}` (carplay.js `noticeMessage`, the first sentence only) and the car shows it: a CPAlertTemplate with OK when idle, a navigation alert in a drive.
- Next: keep checking phone/car parity.

# CALL SHEET

## 2026-11-12 (carplay notice): the car shows only the first sentence of the phone's message (claude/project-thread-me97iw)
- Why: the second sentence is the phone's advice ("Type a start or tap the map"), and errors on the car must never send the driver to the phone. The first is the reason.
- Undo: drop the `carPost(ApexCarPlay.noticeMessage(msg))` line in `toast()` (web/cockpit.js); the car goes silent again.
