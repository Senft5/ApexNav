# STATE

## 2026-11-15 · An early apex is told by the line's own size against the road
- Done: the early-apex tip now says how far before the road's bend your turning centred ("Your turning centred 17 m before the road's bend: turn in later"), the measure that decides it since #974, instead of where the slowest point was ("Slowest 30 m before the apex"). The Log's habit line says the same ("your turning came before the road's bend in 3 corners"). `core/drive_analysis.py _tip` and its port `web/apex_core.js` (value: -road_off_m to a tenth, rounded the same way in both); `web/drive_view.js` words.
- On Nate's drives that is the two corners left after #974: 28 m and 17 m.
