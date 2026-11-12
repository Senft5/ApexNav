# STATE

## 2026-11-12 Build thread forms: fewer words

- Done: the Add a step sheet drops the bold "Tested on a drive (your Log)" label over the drive pick; each drive in the pick now reads "Tested on <drive> · Vetta Score N", and the empty choice still says "Not tested on a drive yet". The two-sentence photo note is one line: "Photos go on once it's posted, without their location." Start a build thread says "Plan its stages. You can change them later." (the field's placeholder already gives the example). e2e checks the form has no label and one short note.
- Next: keep decluttering the social surfaces (Nate 2026-11-12, no walls of text).

# CALL SHEET

## 2026-11-12 Build step form: the drive pick says "Tested on" itself

- What: removed the label over the drive pick and put "Tested on" in each option; shortened the photo note but kept that photos leave without their location (a privacy disclosure).
- Why: Nate's rule against walls of text; a label that only repeats its field is clutter.
- Undo: restore the `el('b', …)` label and the old note in `postForm` in web/builds.js.
