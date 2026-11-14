# STATE

## 2026-11-14 Clips made to post: the domain, a speed switch, a caption and a 9:16 replay
- Done: corner clips and side-by-side clips burn in "vettadrive.com" small under the VETTA mark (corner_clip.js `mark`). A "Show speed on clips" switch with the Log's corner clips (dashcam.js `dc-speed`, kept on the phone as `apex.clipSpeed`) leaves the speed off corner clips, reels, side-by-side clips, the end card's best-corner clip and the replay video. The g trace and the call stay. Sharing a clip or replay puts its caption on the clipboard and says so: the road and the call, "Called by Vetta. Free on iPhone, link in bio.", #drivingroads #backroads and the car's make from its Garage label. Unknown parts are left out (corner_clip.js `caption`). The shell copies it through `shareFile`'s new `caption` field into UIPasteboard; the web tries navigator.clipboard. The replay's video records 9:16 (720×1280, the middle of the map) when the map is portrait, as on a phone (flyover_video.js `portrait`, `cropFor`). Tests: tests/test_clip_share.py, e2e "film the drive".
- Next: county isn't on a drive record, so the caption leaves it out. Add it if the analysis worker ever names the county.

# CALL SHEET

## 2026-11-14 Speed stays on clips by default
- What: the switch starts on, as clips were before. Why: Nate wants speed features, and the switch is for posting to public platforms. Undo: in corner_clip.js `speedShown`, return false when the key is unset.

## 2026-11-14 The replay goes 9:16 by itself on a portrait map, with no new key
- What: no "portrait" option. A phone's map is already portrait, so its video is cropped to exactly 9:16; a landscape map keeps its own aspect. Why: no new controls (the clutter rule), and Reels, Shorts and TikTok all want 9:16. Undo: pass `portrait: false` in cockpit.js startVideo.

## 2026-11-14 The caption tags the car's make, not its model
- What: "#mazda" from "2019 Mazda MX-5". Why: the make is the first word of the Garage label that isn't a year. Splitting a model into a tag would mean guessing. Undo: corner_clip.js `caption`.
