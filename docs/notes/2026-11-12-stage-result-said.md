# STATE
## Session 2026-11-12 (roam-a stage result said): the co-driver says how a saved stage went (claude/project-thread-h7xxmf)

- IDEAS D-05 says "the result is said at the end", but it was only written: a toast, plus the drive's status line for
  VoiceOver. Now, when a stage you marked in the Log ends with corners to compare, the co-driver also says it out loud:
  "Esses: 12 points up on your best." / "Esses: level with your best.". It is technique points, never time.
- web/cockpit.js: `sayQuietLine(text)` is the flow lines' slot, now shared: the lowest quiet line, said when no call is
  due, kept up to 20 s, never in Quiet notes, queued two deep. `noteFlow` and `feedStage` both use it. A stage with
  nothing to compare ("Esses done.") stays written only.
- e2e "a saved stage: the live delta…" now listens to the voice: the result is said exactly once, while you drive on
  past the stage's end.
- Next: another roam item.
