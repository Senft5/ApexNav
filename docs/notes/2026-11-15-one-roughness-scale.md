# STATE

## 2026-11-15 · One roughness scale, read from what phones measured
- Done: `web/roughness.js` (SMOOTH_G 0.034, ROUGH_G 0.068, VERY_ROUGH_G 0.11 g; level / badness / glass / surface) is the one scale. coverage.js (the map's measured roads), route_story.js ("smooth" / "rough"), contributor.js (route card Surface and rough km, the Rough road call, the ranking) and measured_stages.js (stage discovery) read it; no file keeps a roughness number of its own (tests/test_coverage.py). `tools/rough_scale.py` recomputes the cut points from road_bins and fits them to known roads.
- Why: roamer A (2026-11-15) found production road_bins (24,885 bins) max at 0.19 g, most 0.02–0.06 g, while "rough" was 0.22 g in two places and 0.30 g in two others: nothing was ever rough, and Surface read 100 on every road. The cut points are p25 / p90 / p99 of the 7,264 bins two or more passes measured. Roughness barely depends on speed in Nate's 33k bins (log-log slope 0.2; freeways read smoother), so one scale in g holds for now.
- Next: Nate is naming 2–3 roads he knows are broken and 2 he knows are smooth; turn them into OSM way ids, run `python tools/rough_scale.py bins.json --truth truth.json`, and set the three numbers from its answer. The grip loss in apex_core.js effectiveMu (from 0.08 g) and road_feel.js ROUGH_G (0.08) are physics for the envelope, left as they were.

# CALL SHEET

## 2026-11-15 · Roughness cut points from the measured spread until there is ground truth
- What: smooth = the smoothest quarter of production bins, rough = the roughest tenth, very rough (Surface 0) = the roughest one in a hundred.
- Why: the old numbers came from car-body vibration figures, far above what a phone in a cradle feels; a percentile scale says something true now and moves to fit known roads later.
- Undo: put the old numbers back in web/roughness.js (one place).
