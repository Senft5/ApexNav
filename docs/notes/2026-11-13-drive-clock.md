# STATE

## 2026-11-13 A drive keeps the clock, so a video stays lined up through stops (big bet 5, step 2a)
- Done: every 5 m sample a phone records now carries `t_s`, the seconds since the drive started by the fixes' own clock (a new last CSV column; a stop counts, and the car leaves a stop at the last stopped frame, not the fix before it). The drive keeps its start time (`t0`, ms). `ApexRecording.timesOf(Core, d)` gives the drive's time per sample from `t_s`, carrying on at the speed's pace over a hole or for an older drive. The Dashcam panel and Corner clips use it, so a video lined up at the start stays lined up after a red light (it drifted by the whole stop before). tests/test_drive_clock.py; schema `RoadSegment5m.t_s`. Kept on the phone only.
- Next: the app films the drive itself (step 2b) and the page lines the video up from its start time and `t0`, with no slider.

# CALL SHEET

## 2026-11-13 Drive time for video is the clock, drive time for scores stays speed-paced
- What: only the Dashcam panel and Corner clips use `timesOf`; the drive page's corner times, the end card and the Log keep `Core.elapsedS`. Why: those compare drives with each other, and every older drive only has the speed-paced time, so switching them would make old and new drives disagree; a video needs the real clock. Undo: call `ApexRecording.timesOf` in drive_view.js too.
