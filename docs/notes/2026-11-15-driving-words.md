# STATE

## 2026-11-15 · Driving words on tap
- Done: turn-in, apex, late / early / patient apex, trail-braking, entry speed, braking point, back to power, camber and rhythm are underlined where they first show in a paragraph of the Log (the drive page, Your driving, the DNA), the end card and a friend's profile; a tap opens one line under the word ("Turn-in: the moment you start steering into a corner."), a tap anywhere closes it. `web/vocabulary.js` DRIVING / termSpans / watchTerms; style in `web/controls.css`.
- Next: the CarPlay screen has no taps for this; leave it to the phone.

# CALL SHEET

## 2026-11-15 · Driving words: marked in place, once a paragraph
- What: the words are found in the page's text (a MutationObserver on the Log's main, the end card and a profile view) rather than hand-wrapped at each call site; only the first of each word a paragraph is underlined, never inside a button or link.
- Why: Nate didn't know what "turn in" meant; marking every place by hand would miss the next sentence someone writes, and underlining each repeat would clutter.
- Undo: drop the three watchTerms calls (analysis_page.js, cockpit.js twice).
