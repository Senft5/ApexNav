# STATE

## 2026-11-14 the App Store rating on a good drive, and vettadrive.com on the shared card (claude/project-thread-5sbga7)
- Done: the end card asks iOS for the App Store rating (StoreKit `AppStore.requestReview(in:)`, ApexNavApp.swift `askReview`) after a good drive: your best on the road or a Score of 700 and up, from the third saved drive, with the phone's fresh speed under 1.5 m/s (checked again 3 s later, when it asks), once per app version (`vetta.reviewAsked`, the version from the app's user agent). web/end_line.js askReview is the rule. The drive card image now carries "vettadrive.com" under the VETTA wordmark (the owner's domain, bought 2026-11-14). docs/APP_REVIEW.md 5.6.1 row added.
- Tests: tests/test_end_line.py (the rule, each condition); tests/test_drive_card.py (the URL); e2e "the App Store rating" (not before the third drive, never moving, not for an ordinary drive, once per version).
- Next: none; the prompt is a no-op in TestFlight, so it is first seen in the App Store build.

# CALL SHEET

## 2026-11-14 when the end card asks for a rating
- What: good drive (best on road or 700+), third drive on, parked (known speed under 1.5 m/s), once per app version, 3 s after the score lands.
- Why: ratings are the biggest free lever for App Store search (the launch marketing thread); asking after a drive the driver is proud of, and never while moving, is the moment Apple's guidance names. Apple caps it at three a year regardless.
- Undo: drop the endReviewAsk call in endCardScored (cockpit.js); the shell's askReview case can stay.
