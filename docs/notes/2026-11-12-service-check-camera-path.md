# STATE

## 2026-11-12 Service check: "Camera map as the app asks it" follows the app's real path (claude/project-thread-9zycz2)
- Since #462 the app reads our camera list (/api/cameras/v1/region.json) before the Overpass servers; the check's
  cameras_app probe still asked Overpass only, so it read down while the app had cameras. It now calls
  ApexCameras.load with no phone cache, the same path the route card takes.
- Nate's second run (04:01 UTC) was labelled web: all four Overpass servers down or timing out, our list up, every plan up.
- Next: the first run from the iPhone app (source 'ios' in error_counts kind 'service').
