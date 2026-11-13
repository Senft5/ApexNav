# STATE

## 2026-11-13 Live coaching against your best pass, on any road you have driven before
- Done: Vetta now remembers every corner your drives scored, once per spot and direction, keeping its best pass by the Driver Score's technique (grip use, smoothness, braking). On a live drive each remembered corner you finish is scored the same way and set against that best, with no saved stage needed. A bar on the phone ("This stretch +12 vs best, 6 corners") shows the running delta for the stretch. With full notes on, the co-driver says little: "Best yet through there." for a corner clearly better than your best (30 points, at most every third corner), "Smoother on your best." or "Brakes were cleaner on your best." once a stretch when one is clearly rougher (60 points), and how the stretch went once 600 m pass with no remembered corner ("Best stretch yet. 14 up.", "That stretch: 9 down on your best.", "Level with your best."). Corner lines wait at least 20 s apart and use the quiet slot (sayQuietLine). New web/pass_coach.js (tests/test_pass_coach.py). It is built in the analysis worker's `memory` job (`passRefs`), and cockpit.js runs `startCoach` / `feedCoach`. The bar gives way to a saved stage's bar. New voice_lines `line:pass_*` (the packs render them on their next voicebank run; until then the fallback voice says them). e2e "your best pass".
- Next: Nate's call on time gaps on public roads (decision card in the analysis thread). If he says yes, add a time delta per remembered corner from corner_trace.js's position-matched gap.

# CALL SHEET

## 2026-11-13 Live coaching says technique, never time or speed, until Nate decides
- What: the live calls compare smoothness and braking with your best pass, and the bar shows points. No "+0.4 s", no "brake later", no grip-use ("carry more speed") hint. Why: PHILOSOPHY.md §1 keeps time deltas to raceways, and road_memory.js already rules that a voice urging more speed on a public road is not coaching. The coordinator's brief asked for time calls, so the choice went to Nate on a decision card. Undo: in pass_coach.js `line`, add a time line, and in `createCoach` carry a per-corner time from the rows' clock (t_s).

## 2026-11-13 Nothing from the coach on CarPlay
- What: the coach bar is on the phone only, and the car screen shows no delta. Why: no score on CarPlay (driver distraction rules); the voice carries it. Undo: n/a.
