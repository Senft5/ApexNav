# STATE

## 2026-11-14 The Garage draws one rule between things

- **Done:** the Garage page drew two rules in two places. One was under the page's header and over "You" (the header
  draws one, and You's heading drew another). The other was under "Who sees what" and over "Your cars" (the row's own
  bottom line, then the next heading's). Each place now has one rule.
  - The e2e flow "People: two tabs…" checks both. It fails on main.
- **Done:** the Log did the same between the drive list and "Score over time" when no quiet line ("Your roads") sat
  between them. The last row's bottom line and the panel's top rule were 3 px apart. The last row now draws none there.
  - New e2e flow "the Log draws one rule between the drive list and Score over time…". It fails on main.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-14 Garage rules: the heading's rule wins

- **What:** in index.html, `#garageMeBody > :first-child > h3:first-child` joins the list of first headings that draw
  no rule under a sheet header. `#garageMeBody > .stack-8 > .nav-rows:last-child > .nav-row:last-child` drops its
  bottom border, because the next section's heading draws that line.
- **Why:** Nate's standing UX rule asks for clean screens, and a doubled rule reads as an empty section.
- **Undo:** remove both selectors from web/index.html.

## 2026-11-14 The Log's last drive row leaves the line to the panel

- **What:** signature.css `.log-page #historyPanel:not(:has(~ details.quiet:not([hidden]))) .road-index tr:last-child > td`
  draws no bottom border. With a quiet line after the list, that line keeps it.
- **Why:** same as the Garage: a doubled rule reads as an empty row.
- **Undo:** remove that rule from web/signature.css.
