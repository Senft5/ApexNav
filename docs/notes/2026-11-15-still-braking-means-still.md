# STATE

## "Still braking after the apex" means still (2026-11-15)
- Done: `core/drive_analysis.py corner_phases` late_brake_g and its port in `web/apex_core.js cornerPhases`. Late braking is now read from the bin after the apex until the car is back on the throttle (a_lon > 0.05 g). Braking after that is for the next corner. The apex bin itself is not "after".
- Why: on Nate's 13 drives, 3 corners got "Still braking after the apex". In two of them he was back on the gas at about +0.2 g within 5 m of the apex and braked again 60-85 m later for the next bend; GPS agrees. In the third, the 0.26 g sat on the apex bin itself (GPS: 0.06 g) and he was on the gas one bin later. None remain.
- Next: the coach's tips on Nate's drives are now 15 min-speed, 2 brake-later and 1 throttle-sooner (all vs his own best), plus 2 real coasting ones.

# CALL SHEET

## 2026-11-15 · Braking after the throttle is the next corner's
- What: late_brake_g stops at the first bin back on the throttle, and starts at the bin after the apex.
- Why: "still braking" told a driver who had accelerated out and braked again for the next bend that they braked mid-corner.
- Undo: loop late_brake_g over apex..end again, in both places.
