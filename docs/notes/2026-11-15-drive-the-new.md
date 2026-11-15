# STATE

## 2026-11-15 Drive the N new: a roadbook's day out skips the roads you have driven (free roamer B)
- Done: on a roadbook's page, with some roads stamped and two or more still to drive, the lead key is "Drive the 3 new"
  (one drive through only those, nearest first) and a small All key keeps Drive them all. The route card says
  "2 new roads from Smokies day out, nearest first". With none or all driven it stays "Drive them all".
- How: web/roadbooks.js paint keys; cockpit.js driveBook's note reads `book.onlyNew`. No server change.
- Tests: e2e "roadbooks: Drive them all" (A stamped: the key, All beside it, A left out of the drive, the note).
