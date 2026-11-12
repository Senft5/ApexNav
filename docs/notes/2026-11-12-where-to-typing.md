# STATE

## 2026-11-12 Where to? while typing is the field and its list (claude/project-thread-5sbga7)
- Done: Nate's TestFlight note (build 881.1, "evil cluttered gap", screenshot testflight/2026-11-12T163933-where-to-gap.png). With the keyboard up, the sheet shows only the search field and its list. Best roads nearby / Options, Tap the map, the loop dial, the planning rows and Find a loop are hidden. The list shows every place instead of three plus "All places (N more)", so nothing floats over an empty band above the keyboard. Scrolling the list or tapping its background puts the keyboard away and brings everything back. Go with nothing typed only puts the keyboard away; before, it routed to the first recent place.
- Tests: new e2e flow "Where to? while typing ..." raises the keyboard through ApexKeyboard.native(300), as the shell does. pytest; e2e "plan flow", "Where to", "keyboard", "place", "screen by screen" and the startup budget pass.
- Next: check it on TestFlight; plan flow (e, f)'s "the card you tapped stays put when the card shrinks late" also fails about one run in three locally on plain main (not from this change).

# CALL SHEET

## 2026-11-12 the keyboard turns Where to? into a pure search
- What: index.html kb-open rules hide the plan's shortcuts, loop and Find bar; renderPlaces draws every place, and the extras are folded by CSS until the keyboard is up; planBody scroll/click blur the field; Enter on an empty field just blurs.
- Why: one decision per screen (Nate's UI guide): while typing you are choosing a place. Find a loop and Options are one swipe away. A pointerdown listener on the list moved the level cards under a tap in plan flow (e, f), so the tap uses click.
- Undo: delete the three kb-open CSS rules and the two planBody listeners; restore the slice(0, 3) in renderPlaces.
