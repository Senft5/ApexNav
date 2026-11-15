# STATE

## Coasting means the car is slowing (2026-11-15)
- Done: `core/drive_analysis.py _coasting` and its port `web/apex_core.js coasting`. In `corner_phases` / `cornerPhases`, a bin between the brakes and the throttle now counts as coasting only when it is neither braking nor driving (|a_lon| < 0.05 g) AND the car loses at least 0.01 g by the motion sensors and by GPS's speed over 20 m either side. Held speed is part throttle and no longer counts.
- Why: on Nate's 13 drives, coasting was the coach's most common tip (20 corners). In those metres a_lon averaged -0.03 to +0.02 g and GPS's own speed change averaged -0.02 to +0.05 g: in 15 of the 20 corners the car held or gained speed. Now 2 coasting tips remain. Both have 35-45 m of real roll-off (both sensors slowing).
- Effect: fewer "N m coasting between brake and throttle" tips, and the driver profile's Back to power (`exit`, from coast_m) no longer marks down held exits.
- Tests: the fixtures that coasted now roll down 0.1 m/s a bin with the g to match (`tests/test_drive_analysis.py _coast`, the profile's 'coast' fault, `tests/test_road_memory.py` coasted copy of the Dry Ridge sample, whose corners are all at a held speed). The e2e profile check reads its one-row finding from Patient apex; that profile's Back to power finding was the held-speed misread.

# CALL SHEET

## 2026-11-15 · Held speed is not coasting
- What: coasting needs both sensors to say the car is slowing (≥ 0.01 g, neither braking nor driving); held speed counts as part throttle.
- Why: a phone cannot see the pedal, but a car off the gas loses speed. GPS showed Nate's "coasting" corners held their speed (validated measurement error, per the no-flattery rule).
- Undo: make `_coasting` / `coasting` return `abs(a_lon) < COAST_G` again.
