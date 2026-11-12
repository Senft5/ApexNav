# Per-PR notes (read these as the newest part of STATE.md and CALL_SHEET.md)

A PR never edits docs/STATE.md or docs/CALL_SHEET.md. It adds one new file here instead, so parallel PRs never
conflict on those two files:

    docs/notes/YYYY-MM-DD-short-slug.md

    # STATE
    ## Session YYYY-MM-DD (topic): one line (branch)
    - done, still broken, the exact next task

    # CALL SHEET
    ## YYYY-MM-DD (topic): what was decided (branch)
    Why, and how to undo it.

Leave out a section you don't need. A later PR in the same thread edits its own file. `tests/test_notes.py` checks the
format. Now and then a small PR runs `python tools/collect_notes.py`, which puts each entry on top of its file (newest
first) and deletes the fragments.
