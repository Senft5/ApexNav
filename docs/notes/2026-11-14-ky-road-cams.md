# STATE

## Session 2026-11-14 (ky road cams): Kentucky's traffic cameras join the Road cameras layer (claude/project-thread-me97iw)
- `GET /api/traffic/v1/cameras.json` now lists Kentucky's ~250 cameras (KYTC's public ArcGIS layer `trafficCamerasCur_Prd`, the one goky.ky.gov draws; keyless) next to Ohio's 1,117. Pictures are https on www.trimarc.org (in img-src); KYTC's few http-only pictures (INDOT's trafficwise) and offline cameras are left out. Ohio's still need the OHGO key; Kentucky's don't, so the layer works on previews too.
- One state failing still returns the other's, kept 10 minutes instead of a day. The answer is `{ sources, cams }`, each camera with its `src`; the picture's note names whose camera it is.
- After #756 merged, production listed Kentucky's cameras but none of Ohio's, cached a day: a keyed OHGO answer with no cameras counted as "Ohio has none". Now either state answering with none is a failure (the answer names it in `failed` and is kept 10 minutes), and the upstream pages are no longer edge cached a day (`cf.cacheTtl`), only the compacted list is.
- Indiana: CARS publishes only events publicly (the cameras live on an undocumented integration host, not used). Next: Kentucky road weather sensors if KYTC publishes a public layer; TestFlight check of the layer.

# CALL SHEET

## 2026-11-14 (ky road cams): Kentucky's cameras from KYTC's public map layer, Indiana's left out (claude/project-thread-me97iw)
- Why: KYTC's layer is the public one its own traffic map reads, free and keyless. Indiana's cameras sit only on an undocumented CARS integration host, which could change or be closed without notice, so it is not used.
- Undo: drop `getJson(KY_CAMS)` from `camerasResponse` in backend/src/traffic.ts and `www.trimarc.org` from tools/csp.py.
