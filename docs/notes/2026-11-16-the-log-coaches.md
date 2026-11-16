# STATE

## The Log coaches first (2026-11-16)
- Nate: the Log is "kind of confusing and also just boring", it should "feel more like it's coaching you", knowing what
  you want before you ask. web/log_coach.js `brief(drives, profile, words)` gives { headline, why, next, trend, go, kind }:
  - the latest drive's news (within 14 days): your best drive yet (above every earlier one), one of your cleanest or
    rougher than usual (40 points from the median of the drives before), a Score part at its best yet, else "A typical
    drive for you"; why names the part that moved, beside your usual, only beyond that part's own spread;
  - the trend (the last 3 drives' median against the 3 before, 30 points), said only when it moves; with no fresh news
    it is the headline;
  - next: the driver profile's focus with its tip and where it shows most, else the weakest Score part's tip;
  - all null under 3 scored drives; go: the drive id the headline is about.
- The Log's history view opens on it (#logCoach in analysis.html, analysis_page.js renderLogCoach, styled plainly in
  signature.css). The redesign thread ("Redesign Vetta's main look") owns its look: a hero card in place of the big
  Score, the numbers under it on demand. driver_profile.js now exports sideWords.
- On Nate's 13 drives today: "A typical drive for you on Nov 14 · 657, against your usual 650. Rhythm dipped to 15 out of
  100 (usually 58). · Next drive, work on patient apex: stay slow a little longer, until you can see the way out."
- Tests: tests/test_log_coach.py; e2e "the Log coaches first".
- Next: corner-level news in the brief (a corner beaten on a road driven before, the biggest time left), from the
  coach job of the latest drive.

# CALL SHEET

## The Log's coach praises only what measured above every earlier drive (2026-11-16)
- What: "best" needs a Score above every earlier drive; cleaner/rougher needs 40 points from your usual; a part is named
  only beyond 8 points and 1.5 of its own median deviations; pace is never a headline.
- Why: Nate's rule against sycophantic coaching; rhythm swings tens of points drive to drive on his drives.
- How to undo: change CLEAR_BY, PART_BY or the spread factor in web/log_coach.js partMoved.
