# STATE

## Stages on a drive post (2026-11-14)
A drive's post now shows the stages the driver saved in the Log that the drive went over, each with its Vetta Score
there, so friends see "Tellico climb 812" under the card. `web/analysis_client.js` `stagesOn` (Core.segmentPass on the
stored drive, at most three, in the order driven) runs in the `save` job and in the new `stagesOf` job (a record's end
card); `web/cockpit.js` passes `apex.segments` and puts `stages` on the end card's post; `web/drive_posts.js` sends them and
draws `.feed-stages`. The server already took `stages` (0059). Test: e2e "drive posts: …".
Next: a tap on a friend's stage could open its board (analysis.html SEGMENTS) when the stage is shared.

# CALL SHEET

## A stage's Score on the post, never its time (2026-11-14)
What: a post's stage row shows the Score only. Why: the post schema has no time field ("no times along the line"), and
time sharing has its own switch per friend and crew. Undo: drop `stages` from `bodyOf` in web/drive_posts.js.
