# STATE

## 2026-11-13 Best roads nearby: on a phone the road name gets its own line

- **Done:** at 520 px wide or less, each row of the Best roads nearby list puts the road name on its own line, with the
  three numbers (good corners, length, drive there) left-aligned under it. The heads name only the numbers. Before this,
  four columns left the name about 80 px on a 390 px phone, so "East Alexandria Pike" broke over three lines.
  - Wider screens keep the table as it was.
  - The e2e flow "plan flow (c) best roads nearby" checks the name's width and that the Road head is hidden.
- **Done:** About a road, opened from that list, ends in a solid Plan this road key held at the sheet's foot. Before
  this the page was a dead end, with Close its only key. The key plans that road, as the row does.
  - It is covered by the e2e flow "best roads nearby: About a road has its own Plan this road key".
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-13 The nearby list stacks on a phone, and its Road head goes

- **What:** below 521 px the `.nb-cells` grid has three equal columns, with the name spanning all three. The Road head is
  `display: none`. It stays in the DOM, so the e2e head check still reads all four.
- **Why:** Nate's standing UX rule, "clean and intuitive". A road name in three lines read as clutter, and a head reading
  "Road" over a road name says nothing.
- **Undo:** delete the `@media (max-width: 520px)` block after `.nb-row .linkbtn` in web/index.html.

## 2026-11-13 About a road gets a Plan this road key

- **What:** `openRoadPage(s, go)` takes an optional `go`. The nearby list passes `() => driveStage(i)`. The key is a
  `.find-key` in a sticky `.rp-go` bar, the same pattern as Find a loop. It closes the page, then plans the road.
- **Why:** a page about a road you are choosing should let you choose it.
- **Undo:** drop the `go` argument at the About button in cockpit.js `showExplore`.
