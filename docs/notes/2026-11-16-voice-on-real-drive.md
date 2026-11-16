# STATE
## Session 2026-11-16 (voice on Nate's real drive): fewer, better-placed lines (claude/project-thread-m2wech)
- Nate's 11-16 Blue Ash drive logged 182 spoken lines in 29 mi. 28 were "Camera" (plate readers, often two a second apart), 19 were "Hidden junction" (four in 160 m on one suburban street) and 80 were turn calls (three per turn). It also said "Rerouting" and a new turn right after "Your destination is on the right". Every line was played by the chosen voice (`said[].eng` = pack), so on this drive there was no fallback to the phone's robot voice.
- Done:
  - Plate readers are no longer spoken (the pin stays); speed cameras still are.
  - "Hidden junction" is said at most once every 400 m, and never within 150 m of a route turn.
  - With the notes awake, a turn less than 1200 m after the one before gets the near call and the at-turn call only, without "In 0.4 miles"; a longer leg keeps all three.
  - Within 150 m of a route's end, driving on is not off route: no reroute and no "Rerouting".
- Still open: the first ~1 km of this drive has spoken lines but no recorded rows (`said[].t` is null at m = 0), so the replay starts on Reed Hartman Hwy. Next task: find why the recording's rows started late.

# CALL SHEET
## 2026-11-16 (voice on real drive): plate-reading cameras are silent; speed cameras still spoken (claude/project-thread-m2wech)
28 "Camera" lines in one drive were noise, and the bare word didn't say what kind of camera it was. Plate readers still steer Avoid cameras routing and still show as pins and on the strip. Undo: in web/cockpit.js, make `spokenCamera` return true for any `alpr` event.
## 2026-11-16 (voice on real drive): no far turn call while the notes are awake (claude/project-thread-m2wech)
On a fun route a turn comes every few tenths of a mile, and three calls per turn crowded out the corner notes. The near call (12 s out, with distance) and the call at the turn remain. Undo: drop `{ brief: spirited }` from the `ApexDirections.due` call in cockpit.js.
