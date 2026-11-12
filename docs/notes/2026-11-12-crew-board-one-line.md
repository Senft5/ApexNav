# STATE

## 2026-11-12 Crew board: one line under each name (free roamer B)
- Walkthrough of a crew's Board tab: a long car name ("2019 Mazda MX-5 Miata RF Grand Touring") took two lines and the drive count a third, so five crew-mates filled the phone screen.
- Done: under each name, one line, "4 drives · 2019 Mazda MX-5 Miat…", cut short with an ellipsis (the whole line in its title). A crew-mate with no Score this period gets no line. Checked in e2e "crew page: an old ?view=crew link…".
- Next: keep walking the social screens (a convoy from People).

# CALL SHEET

## 2026-11-12 Board rows: drives · car on one line (free roamer B)
- What: crew_page.js board rows join the drive count and car into one `.cp-sub` line with ellipsis.
- Why: the owner's rule (2026-11-12) to keep social screens clean like major social apps; leaderboards elsewhere keep each row to two lines.
- Undo: restore the two separate `small` lines (car, then `.cp-drives`) in board() and drop the `.cp-sub` rule.
