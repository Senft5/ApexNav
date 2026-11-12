# STATE
## Session 2026-11-12 (social, no walls of text, part one): short copy on the social screens (claude/project-thread-uwmi4e)
- Nate: "the app in general feels cluttered and unintuitive … Social features should feel just as easy to use as any major social media app. Walls of text should be banned wherever possible."
- Done: every paragraph on duels, time attack, the crew page, meets and roadbooks is now a few words. tests/test_social_copy.py caps any fixed textContent in the social files at 80 characters.
- Done: a crew drive's card has one Going / Maybe / Can't switch (it was an "I'm going" key, and the same answer again as a switch under More); More no longer repeats the roles line or names who is going under three faces.
- Done: a tap on a friend opens their profile (the UI thread handed over People's friend rows in cockpit.js). The profile holds what you do with them, their last share and "What @x sees of you" (opens Who sees what). With no signal it still opens: the person and the keys, "Couldn't load the rest."
- Next: the crew page itself (chat, board, members, meeting points stacked on one long page); the For you list; the Where to? time attack row.

# CALL SHEET
## 2026-11-12 (social copy): privacy lines kept, but as one short line (claude/project-thread-uwmi4e)
The convoy ("Shares your position until you leave.") and meeting points ("A 7 mile square around Home, never the address or whose.") still say what is shared, in one line each; the full rules stay on the privacy page. A duel no longer says "Your Scores don't reach @bob yet": the "Show my Scores to @bob" key says it. Undo: revert this PR's copy edits.

## 2026-11-12 (friend profile): the friend row opens nothing in the list (claude/project-thread-uwmi4e)
A social app's friend is a row that opens the person. The five keys, the last share and the grants drawer moved to the profile; Scores and Times switches per friend now live only in Who sees what (one tap from the profile). Undo: revert the People commit; the old row code is in git history.
