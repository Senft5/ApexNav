# STATE

## 2026-11-16 A crew's composer
- Done: a crew's Posts tab starts with "Post your latest drive" (`crew_page.js` composer, cockpit `postLatestTo`): the Post sheet opens on your newest drive from the last 30 days with that crew picked; posting redraws the page. `compose()` takes `d.to` (a crew you are in). The Log's clip post and this share `postOfRec`. e2e: the crew page flow posts a stored drive to the crew.
- Next: from `social/screen-inventory.md`: crew empty / offline states as one line and one key; Join from a link as the crew's page preview.

# CALL SHEET

## 2026-11-16 The crew composer posts your latest drive, not a picker
- What: the composer opens the sheet on your newest postable drive; there is no list to pick an older one from it.
- Why: the drive you just did is almost always the one you want to post ("knows what you want"); older drives post from the Log.
- Undo: give `postLatestTo` a picker of `ApexRecording.summaries()` before `compose`.
