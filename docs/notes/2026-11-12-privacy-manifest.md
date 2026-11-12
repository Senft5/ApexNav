# STATE
## Session 2026-11-12 (App Store risks): the app had no privacy manifest; it has one now (claude/project-thread-g9yher)
- Done: `PrivacyInfo.xcprivacy` in the app target (project.yml), matching LISTING.md's App Privacy answers; UserDefaults (CA92.1) and system boot time (35F9.1) declared. tests/test_privacy_manifest.py keeps code, manifest and listing in step.
- Check on the next TestFlight upload: no ITMS-91053 "Missing API declaration" mail from App Store Connect. MapLibre's xcframework carries its own manifest.

# CALL SHEET
## 2026-11-12 (App Store risks): every collected type declared "App functionality" (claude/project-thread-g9yher)
LISTING.md's "product improvement" for road data has no matching manifest purpose; App functionality is the honest fit, and diagnostics add Analytics as the label does. Precise location is declared linked (the hazard and friends-map uses are), the stricter reading. Undo: edit PrivacyInfo.xcprivacy and LISTING.md together (the test checks they agree).
