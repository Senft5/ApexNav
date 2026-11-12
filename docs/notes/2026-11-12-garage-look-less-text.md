# STATE

## Session 2026-11-12 (declutter 1): Look and voice and Co-driver without the essays (claude/project-thread-5sbga7)

- Nate's TestFlight note 1 (build 773.1, 02:45Z, "walls of text"; taken over from the TestFlight thread): the theme cards
  lose their paragraph and the printed sample quote (the card says "Marguerite · suggested voice"; Hear still says the
  call); gone too: Look and voice's intro, "Auto turns the page over after sunset", the Soundtrack essay and its "Music
  made by the road" line (the switch and "Hear a sample" stay), the Notes paragraph, and "Off. Road and route names use..."
  under Speak road names. The voice line under Co-driver's voice shows only for Suggested ("Hale, the voice Tiburon
  suggests."). The words example stays (it is the setting's answer).
- Note 6: Ways to go has no convoy paragraph under its keys (the convoy sheet says the rest).
- Note 8: Where to?'s chip row is Best roads nearby and "Options · N" only; each option on is named in the chip's
  VoiceOver label, and the route card still shows one chip per option.
- e2e: the theme-cards flow checks the card's voice line instead of the quote; plan flow (d) and the screen-by-screen
  flow check the count on Where to? and the chips on the card.
- Note 7: Where to?'s "Or loop from here" loses "back where you started"; Spots, Time attack and Roadbooks rows are
  their names only (the time attack row still becomes this week's loop and your place once it has loaded).
- Note 2: Crews this month lines are the crew's numbers ("Ridge Runners · 160 km · Smooth 85 · #2 of 2"); private and
  small crews just carry no rank; the "Public crews of 3 or more..." footer is gone; with nothing new, "Latest from your
  crews" shows no heading and no line.
- Note 3: Log list rows lose the corner-tick bar; a drive with no Score shows nothing in the score column (its own page
  still says --); "To 10069 Pebble Ridge Ln" lists as "To Pebble Ridge Ln" (street addresses only; the saved name is kept).
- Next: Your driving (notes 4, 5).

# CALL SHEET

## 2026-11-12 (declutter 1): the Garage's look and co-driver settings lose their explanations (claude/project-thread-5sbga7)

Your TestFlight note on the Garage settings: the helper lines are gone. Each theme card is the look itself, its name, its
voice and Hear; the Night, Soundtrack and road-names switches have nothing under them. The one line kept is the words
example ("For example "Careful, medium right, long""), since it is what the switch changes. Undo: revert this PR.

## 2026-11-12 (declutter 6, 8): Ways to go and Where to? lose a paragraph and a row of chips (claude/project-thread-5sbga7)

Ways to go is its keys and Cancel. Where to? shows "Options · 3" instead of a chip per option (each is still read out to
VoiceOver, and still shown one by one on the route card, where the route was planned with them). Undo: revert this PR.

## 2026-11-12 (declutter 7, 2, 3): Where to?'s rows, Crews this month and the Log list (claude/project-thread-5sbga7)

Where to?'s rows say their names. Crews this month is numbers only. A Log row is the date, the road, its facts and the
Score; a drive with no Score leaves the column empty there (a blank, never a made-up number; the drive's page shows --),
and a house number is dropped from a street-address name in the list only. Undo: revert this PR.
