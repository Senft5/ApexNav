# STATE

## Stage Board: a friend's handle opens their profile (2026-11-13)
On the Log's Stages board, a row by a friend shows their handle as a link (`index.html?view=friends&friend=<handle>`),
the same link Friends lately uses (#645), so in the app frame it closes the Log onto their profile. You and non-friends
stay plain text. e2e: "a friend on a stage's Board is a link to their profile, as on Friends lately".
Next: keep sweeping social surfaces for handles that should open the person.

# CALL SHEET

## Only friends link on the Board (2026-11-13)
What: only handles in your friends list are links; a crew-mate who isn't a friend stays plain.
Why: the People profile only exists for friends; a link to a stranger would open nothing.
Undo: in web/analysis_page.js drawBoard, drop the `friendHandles` check.
