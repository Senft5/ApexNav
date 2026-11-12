# STATE

## 2026-11-12 Garage settings: three footnotes gone
- Done: Reminder's note is one short line ("At most once a week: the evening before you usually drive, or before a crew drive, with a road to try."). Units' driving-side paragraph is the label "Driving side", with the reason in its tooltip and the switch's aria label. Your data's offline line drops the web-cache footnote ("Nothing saved for offline." alone when empty).
- Tests: tests/test_my_data.py checks the empty line is exactly "Nothing saved for offline." and that no cache sentence is added; e2e your data, units, Garage flows pass.
- Next: keep checking the Garage, Where to? and Log against Nate's general UI/UX guide (project files reference/), used as background.

# CALL SHEET

## 2026-11-12 settings footnotes cut
- What: shortened the Reminder note, folded the driving-side explanation into a tooltip/aria label, removed the web-cache footnote from Your data.
- Why: Nate's no-walls-of-text rule and the general principle (from his UI/UX guide) that words should serve a decision. The reminder's behaviour and its App Review wording are unchanged.
- Undo: restore the three strings in web/index.html and web/my_data.js, and the test lines in tests/test_my_data.py.
