# STATE

## 2026-11-14 Live coaching says the time gap to your fastest pass, and "brake later"
- Done: each remembered corner (web/pass_coach.js) now also keeps its fastest pass: the time from the corner's start to its end, measured over the same points on every pass, and how far before the apex braking began. Live, with the rows' clock (t_s), each corner you finish gets a gap to that time. The phone bar shows the stretch's gap ("−1.2 s vs best"). With full notes on, the co-driver says "Best yet. Three tenths up." for a corner 0.2 s or more quicker than your fastest pass (at most every third corner), and "Four tenths down." for one 0.3 s or more slower. It adds "Brake later." when you braked 15 m or more before your fastest pass did. When the stretch ends it says "Best stretch yet. 1.4 seconds up." or "That stretch: six tenths down on your best.". On the way into a corner where your latest drive braked early and lost 0.3 s or more, the co-driver says "Brake later here." once, in a quiet moment (`ApexPassCoach.notes`, which joins the corner coach's notes in the worker's `memory` job). Without a clock (old rows), the technique lines from #696 stay. PHILOSOPHY.md §1 says so. tests/test_pass_coach.py has new timed cases. The e2e "your best pass" drives with a frame clock and expects a time line.
- Next: watch the first real drives for chattiness; the thresholds are UP_S, DOWN_S and EARLY_M in pass_coach.js.

# CALL SHEET

## 2026-11-14 Time gaps against your own fastest pass only, on the phone and in the voice
- What: the gap is always to your own fastest pass over the same corner, never anyone else's, and never shown on CarPlay. Why: the owner said yes to time gaps and "brake later" on public roads (2026-11-14). Your own best keeps it a coach, not a race, and nothing about it leaves the phone. Undo: in pass_coach.js `line`, drop the `finite(ev.gap)` branches (the technique lines come back).

## 2026-11-14 "Brake later here" only where the latest drive braked early and lost time
- What: the approach call needs both: your latest drive braked 15 m or more before your fastest pass, and it was 0.3 s or more slower through the corner. Why: braking early on its own can be the right call (traffic, a wet day). Only when it cost time is it worth saying, so the voice stays sparse. Undo: change EARLY_M / DOWN_S, or filter in `notes`.
