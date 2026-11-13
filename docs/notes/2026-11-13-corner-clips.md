# STATE

## 2026-11-13 Corner clips: a corner of your drive video as a portrait clip to share (big bet 5, step 1)
- Done: on a drive's page, once a video is lined up in the Dashcam panel, Corner clips lists every corner call the video holds ("Corner 1 · Left 4") and Make a clip cuts it, from 4 s before the corner to 2.5 s after, into a 720×1280 portrait video with the road's name, the call, the speed, a live cornering and braking g trace with a cursor and the friction-circle dot burned in, then hands it to the share sheet (Reels, Stories, Messages, Files). Corners the video does not hold are not offered. New web/corner_clip.js (tests/test_corner_clip.py); web/dashcam.js mounts it; e2e "corner clips".
- Next (big bet 5): record the video in the app during the drive so it is lined up by itself (no hand-set offset), then one tap from a great corner on the drive page to its clip; the post side with the social thread.

# CALL SHEET

## 2026-11-13 Corner clips cut from the corner calls, not the scored corners
- What: a clip's corners are the drive's corner calls (d.events, start_m to end_m), labelled with the call. Why: every drive with a road has calls, and they are what the Dashcam overlay already shows; scored corners need speed and g that an imported drive may lack. Undo: build `cornersOf` from d.corners (start, end) instead.
