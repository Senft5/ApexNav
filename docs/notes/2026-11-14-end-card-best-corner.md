# STATE

## 2026-11-14 the end card loops your best corner and shares it in one tap (claude/project-thread-5sbga7)
- Done: once a filmed drive is stored, the end card asks ApexBestClip.find(id) (best_clip.js, #720) and, when it finds a corner, shows a tile first over the keys: the stretch of the app's own film looping muted (still under reduced motion), "Best corner", its label (Corner 3 · Left 4) and Share clip. One tap makes the portrait clip (ApexBestClip.make) and opens the share sheet (ApexDriveCard.shareFile, the app's ApexSaveFile in the shell); "Clip saved." where it downloads; a phone that can't record says so and the post still works. No film, the website, or no corner inside the film: no tile.
- Tests: e2e "end card best corner" (no film no tile; the tile, its stretch, first and full width; one tap makes and shares the clip named for the road; the next unfilmed drive plays nothing).
- Next: put the clip on the Friends post itself once posts can carry a video (R2 upload).

# CALL SHEET

## 2026-11-14 the best corner clip shares through the share sheet, not the Friends post
- What: the tile's tap makes the clip and shares the file; Post to friends stays the drive's score and line.
- Why: /api/posts carries no video yet (needs an R2 upload path and moderation), and the share sheet reaches Instagram and Messages today. The tile is first over the keys because a moving picture of your own best corner is the thing people want to send.
- Undo: delete #endClip from the end card markup and paintEndClip / endClipReset from cockpit.js.
