# STATE
## Session 2026-11-12 (social, no walls of text, part one): short copy on the social screens (claude/project-thread-uwmi4e)
- Nate: "the app in general feels cluttered and unintuitive … Social features should feel just as easy to use as any major social media app. Walls of text should be banned wherever possible."
- Done: every paragraph on duels, time attack, the crew page, meets and roadbooks is now a few words. tests/test_social_copy.py caps any fixed textContent in the social files at 80 characters.
- Next: the meet card's More repeats Going/Maybe/Can't and the lead line; the friend row opens five buttons (cockpit.js, the UI thread's file: coordinate); the crew page's planner is an open form.

# CALL SHEET
## 2026-11-12 (social copy): privacy lines kept, but as one short line (claude/project-thread-uwmi4e)
The convoy ("Shares your position until you leave.") and meeting points ("A 7 mile square around Home, never the address or whose.") still say what is shared, in one line each; the full rules stay on the privacy page. A duel no longer says "Your Scores don't reach @bob yet": the "Show my Scores to @bob" key says it. Undo: revert this PR's copy edits.
