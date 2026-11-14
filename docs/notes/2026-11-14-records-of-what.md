# STATE

## 2026-11-14 A drive's record line says what it is the best of

- **Done:** a drive's "Against your records" line read "Cleanest tight corner: 100 · your best of 12", which doesn't say
  12 of what. It now reads "· your best of 12 tight corners" (or medium, fast), the count of that size of corner over
  every drive.
  - tests/test_best_corners.py and the e2e flow "Your driving: the profile over every drive…" expect the new words.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-14 Name the corner size in "your best of N"

- **What:** driver_profile.js `driveRecordLines` adds the size and "corners" after the count.
- **Why:** a TestFlight note (2026-11-12) already called an earlier version of this line a riddle, and "of 12" alone
  still leaves you guessing.
- **Undo:** drop `${z} corners` from that line and the two tests.
