# STATE

## 2026-11-13 Share card: the date once, only the corners driven (free roamer B)
- Walkthrough of Share card after a drive no road named, on a phone: the picture's title was the date name ("DRIVE 11/13/2026 7:20 PM") over a date line ("Nov 13, 2026 · 2.5 mi"), and the corner line read "0 tight · 0 medium · 8 fast corners".
- Done: web/drive_card.js cardTitle gives a date-named drive the part of the day as its title ("Evening drive", as sports apps name a workout); a road's or route's name stays. mixLine names only the kinds driven ("8 fast corners"). The stored drive name is unchanged (other code reads "Drive <digit>" as a stand-in name). tests/test_drive_card.py holds both.
- Next: keep walking after a drive (Drive it again) on a phone.

# CALL SHEET

## 2026-11-13 Share card title by part of day (free roamer B)
- What: on the share picture only, a drive named by its date shows "Morning/Afternoon/Evening/Night drive"; the corner line skips kinds with none.
- Why: the date was printed twice and zeros were noise on the one picture people post.
- Undo: draw m.name again and the old three-count mixText in drawCard; drop cardTitle and mixLine.
