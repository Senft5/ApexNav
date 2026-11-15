# STATE

## 2026-11-15 · "You apex early": checked on Nate's 13 real drives
- Done: the solo early-apex note needs a real dip (1 m/s, was 0.3 m/s: half the 37 notes on 11 drives were under 2 mph, which 1 Hz GPS cannot tell), the slowest point more than one GPS fix of travel before the tightest point, and the motion sensors agreeing (`imu_slow_m`: where smoothed a_lon goes from slowing to speeding up, against where a_lat / v^2 peaks; `core/drive_analysis.py _imu_slow_m`, `web/apex_core.js imuSlowM`). 37 notes became 12. Patient apex (the skill) is now the mean of the GPS and the sensors' readings: 74.5 → 75.2 over the same 87 corners, so the skill was not a measuring error and stays where it is.
- Found: the "apex" is the tightest point of the path the phone recorded, never the map's; GPS positions run up to a second behind the motion sensors on the Oct 30 – Nov 3 builds (the IMU's g leads GPS by 5–10 m, cross-correlated per drive), about 0–5 m on the Nov 14 build. Both the slowest point and the apex come from GPS, so on average they shift together.
- Next: correct the per-drive IMU-to-GPS lag before the brake measures (brakes done by the apex, trail-braking, turn-in), which compare IMU g with the GPS apex: on the older drives braking reads 5–10 m earlier than it was, which flatters them.

# CALL SHEET

## 2026-11-15 · Early apex needs the GPS and the motion sensors to agree
- What: no early-apex note unless GPS (its speed against its path) and the IMU (a_lon's zero crossing against the a_lat / v^2 peak) both put the slowest point 15 m or more before the tightest point, with a dip of 1 m/s and more than a fix of travel early.
- Why: Nate (2026-11-15) disputed it and asked for no flattery. Half the notes were below what GPS resolves; others GPS and the sensors disagreed on. Where both agree he is still told (12 corners on 7 drives).
- Undo: SOLO_APEX_DIP_MPS back to 0.3, drop GPS_FIX_S and the imu_slow_m clause in both _tip / coachTip; `early` back to (a - slow) * 5 in both driver_profile files.
