# STATE
## Session 2026-11-12 (roam-a best run live): the co-driver counts clean corners in a row (claude/project-thread-h7xxmf)

- IDEAS D-30, part four. web/flow_live.js `createWatch(Core, ApexFlow, { mu })`: on the live 5 m rows, each corner is found
  in the last 1.2 km (ApexCore.profileRecording) and judged once, 30 m after it ends, by flow.js's rule (cornerTechnique,
  inFlow, GAP_M). It says "Five clean in a row." at 5, 10, 20, 30... A corner can't be judged twice (a later window's
  copy of it starts before the last judged corner's end).
- web/cockpit.js `noteFlow` on every live frame; `flowSay` is the lowest quiet slot (after brake heat and a break cue),
  dropped after 20 s unsaid and never said in Quiet notes. `drive.flow` resets each drive; `apexDebug.flowRun` for e2e.
  flow.js now exports GAP_M. index.html loads flow_live.js after flow.js (deferred).
- Tests: tests/test_flow_live.py (the real Dry Ridge geometry driven gently gives the same run live as afterwards: 18,
  and 7 driven briskly; no g says nothing; a lower-grip car agrees); e2e "the co-driver counts clean corners…".
- Next: D-16's wider lines, or the road book marking corners that evened out.

# CALL SHEET
## 2026-11-12 (roam-a best run live): the co-driver praises a run of clean corners (claude/project-thread-h7xxmf)

While you drive, the co-driver says "Five clean in a row." when five corners in a row were smooth, settled and inside the
limit, then at ten and every ten after. Calls: milestones only (a word every corner would be noise); it waits for a quiet
moment below hot brakes and a break cue and is dropped after 20 s (late praise means nothing); it speaks in Auto and Full
notes, never in Quiet; technique only, so a slow smooth run counts the same as a quick one (the guardrails). Undo: remove
`noteFlow()` from the two frame handlers in cockpit.js.
