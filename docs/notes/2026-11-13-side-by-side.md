# STATE

## 2026-11-13 Side by side: one corner, this drive and your best pass, both filmed, in one clip (big bet 5, after step 3)
- Done: in a corner's overlay against your best pass, when the app filmed both drives (Film the drive), **Side by side with your best pass** makes a portrait clip. This pass plays on top and the best pass below. Both start 3 s before the corner on their own drive (the same point on the road) and play together in real time, so the quicker one gets ahead. The seam shows the time gap counting from 0.0, taken from the overlay's position-matched gap (amber while behind, green while ahead), and each half shows its speed. The quicker pass holds its last frame until the slower one is through. New web/ghost_clip.js (tests/test_ghost_clip.py). corner_trace.js now also gives `i0` and `b_win` (the corner on the best pass's drive). The dashcam panel has `canGhost` / `ghost`; drive_view.js `actKey`; analysis_page.js `ghostOf`. e2e "side by side".
- Next: when the social hook (`page.post`) is live, a Post key beside the clips.

# CALL SHEET

## 2026-11-13 Side by side plays both passes in real time, not frame-matched by position
- What: both videos play at 1× from the same road point, and only the gap figure is matched by position. Why: seeking a second video every frame to follow the first by position stutters on a phone, and real time shows what a driver sees, the best pass pulling away. The counting gap says where on the road it happened. Undo: in ghost_clip.js `record`, drive vb.currentTime from a's sample through the trace each frame.

## 2026-11-13 Clips stay on the phone; nothing goes to R2 from this thread
- What: corner clips, reels and side-by-side clips are made on the phone and handed to the share sheet. No server storage. Why: posting inside Vetta is the social thread's (the coordinator's note: media in R2 with social's MEDIA plan); this thread only hands it the blob through `page.post(blob, meta)`. Undo: n/a.
