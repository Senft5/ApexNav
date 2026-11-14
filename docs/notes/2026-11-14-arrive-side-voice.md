# STATE

## Session 2026-11-14 (arrival side in the pack voice) (claude/project-thread-mtq095)
- Done: #804 says "Your destination is on the right/left"; the packs only had `nav:arrive`, so that call would have gone
  back to the phone's voice. Added `nav:arrive_right` / `nav:arrive_left` in Marguerite, Kit and Hale (Whisper-checked);
  `voice_lines.js maneuver()` picks them from Valhalla 5/6 or the step's `side`, as `directions.js sideOf` does.
- Next: none for this; a new spoken line still needs its words in `voice_lines.js` TEXT and `voicebank.py --rebuild-checked --only`.
