# STATE

## 2026-11-14 People: a rule closes For you before your friends

- **Done:** on People → Friends, the For you rows ran straight into "You · @me" and your friends with no rule or heading
  between, so the friend rows read as more For you rows. When For you or the Feed is shown above, the you row now draws
  a rule on top. With neither shown, nothing changes.
  - New check in the e2e flow "For you: the People badge counts…". It fails on main.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-14 A rule, not a "Friends" heading

- **What:** index.html `#accountBody > section:not([hidden]) ~ .you-row { border-top: 1px … }`.
- **Why:** the tab above is already named Friends, so another heading would say it twice. For you's own heading draws a
  rule, and a rule after its last row closes the list the same way.
- **Undo:** delete that one CSS line.
