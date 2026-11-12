# STATE

## 2026-11-12 the measured-roads toast is one line (claude/project-thread-5sbga7)
- Done: switching on measured roads in Layers toasted three sentences (196 characters) that vanish before they can be read. It now reads "Green smooth, amber fair, red rough. No line yet? Map it first for extra points." Tapping a road still explains what was measured.
- Tests: pytest; e2e flows matching "Layers" and "measured".
- Next: keep sweeping the shell's toasts.

# CALL SHEET

## 2026-11-12 shorter measured-roads toast
- What: one toast string in web/cockpit.js (the coverage switch).
- Why: Nate's no-walls-of-text rule; a toast is one glance. "Bolder the surer" and "tap one" were dropped: the tap is discoverable, and the line weights speak for themselves.
- Undo: restore the old string.
