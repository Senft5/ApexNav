# STATE
## Session 2026-11-12 (notes fragments): STATE.md and CALL_SHEET.md stop conflicting (claude/project-thread-g9yher)
- A PR no longer edits docs/STATE.md or docs/CALL_SHEET.md: it adds `docs/notes/YYYY-MM-DD-slug.md` with `# STATE` and/or
  `# CALL SHEET` sections (docs/notes/README.md). tools/collect_notes.py folds them in (newest on top) and deletes them;
  `--check` validates; tests/test_notes.py. CLAUDE.md rules 1, 6, 7 say so. `.gitattributes` merge=union on both files
  so a local merge of an older branch keeps both sides.
- Also in this PR: the cron monitoring (migration 0055, applied on preview and prod) and the lighter CI per push.
- Next: run `python tools/collect_notes.py` in its own PR once a dozen notes pile up; offline behaviour and App Store /
  TestFlight readiness checks.

# CALL SHEET
## 2026-11-12 (notes fragments): one note file per PR instead of editing STATE.md and CALL_SHEET.md (claude/project-thread-g9yher)
Every PR wrote the top of the same two files, so parallel threads lost green CI to conflicts several times a night.
New files never conflict. merge=union alone was not relied on: GitHub's PR mergeability check is not documented to honour
`.gitattributes` merge drivers, so it is kept only as a help for local merges of older branches. Undo: delete docs/notes/, tools/collect_notes.py, tests/test_notes.py and
.gitattributes, and restore CLAUDE.md rules 1, 6 and 7.
