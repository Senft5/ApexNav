# CALL SHEET

## 2026-11-13 (carplay no board): the car's time attack rows show the length, never your place on the board (claude/project-thread-me97iw)
- Why: docs/APP_REVIEW.md promises no scores or social features in the car, and CarPlay navigation apps may show only what driving needs. #621 put "you're 3rd of 8" under the featured row; now it reads "Time attack · Featured · 20.0 mi" and the board stays on the phone.
- Undo: put `ApexTimeAttack.summaryLine` back in cockpit.js `carPlaces` for the featured row's detail.
