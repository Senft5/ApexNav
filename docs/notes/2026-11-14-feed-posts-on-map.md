# STATE

## 2026-11-14 Feed posts show their road on the real map (claude/project-thread-5sbga7)
- Done: on People → Friends, each post's line now sits on the real map of the streets round it, in the theme's own map palette, as Strava and every running or riding app shows an activity. Before, the line sat on a blank well. web/post_map.js keeps one hidden MapLibre map. It draws each post as its card nears the screen and hands back a still picture (a blob URL) laid exactly under the SVG line (viewFor matches drive_posts.lineSvg's fit to within a pixel). The map goes 20 s after the Feed is left alone. A post that can't get a map (offline, no WebGL, the map's server failing) keeps its plain line. Never while a drive is on.
- Tests: tests/test_post_map.py (the camera lies under the line in Ohio, Tennessee and Norway; no line, no map). e2e "the Feed: each post's line is on the real map" (two posts, one hidden map; offline asks for none).
- Next: the same picture behind the post's line in the Post sheet's preview, and on a friend's profile.

# CALL SHEET

## 2026-11-14 one hidden map renders every Feed post's map
- What: a single off-screen MapLibre map (preserveDrawingBuffer) takes a JPEG still of each post in turn, instead of a live map per post.
- Why: a live map per card would cost a WebGL context each (phones cap them at about 16) and scroll badly; a still is as good for a feed and is cheap to keep.
- Undo: drop mapUnder from the ApexDrivePosts.mount call in cockpit.js; posts go back to the plain line.
