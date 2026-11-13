# STATE

## 2026-11-13 End card: the practised skill is said once
- Done: when a practice line names a skill ("Practice on Dry Ridge Rd · One steering arc: …"), the road line under it no longer adds "Lost most: one steering arc". `roadEndLine(r, skip)` / `roadUnevenLine(r, skip)` (web/driver_profile.js) drop the clause when its skill is the practised one; the drive job and the `coachLine` job (web/analysis_client.js) pass the skill; cockpit.js asks for practice first.
- Next: keep cutting repeated words on the end card and Your driving.
