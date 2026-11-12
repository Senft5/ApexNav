# STATE
## Session 2026-11-12 (social, never in the way of the road): a convoy invite waits until the drive ends (claude/project-thread-uwmi4e)
- Done: a convoy invite that lands while you drive isn't toasted or marked seen; when the drive ends the page asks again and toasts it (convoy_ui.js loadAsked). The rest of the social pings already wait: For you doesn't poll during a drive, plain toasts go to the drive's status line, and the invite card is hidden while driving.
- Next: the duel card keys.

# CALL SHEET
## 2026-11-12 (invites while driving): held, not dropped (claude/project-thread-uwmi4e)
A convoy invite mid-drive used to pop a toast with a key over the map. Now it waits until the drive ends, so joining a convoy you're invited to mid-drive takes stopping first; the leader's invite still lasts its time. Undo: revert this PR.
