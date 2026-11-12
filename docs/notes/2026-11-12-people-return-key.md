# STATE

## 2026-11-12 People: Return on the keyboard sends and creates (free roamer B)
- Walkthrough of a new signed-in account on People: the empty Friends and Crews pages read cleanly, but the Return key did nothing in the Invite sheet's handle field or in the new crew's name field. On a phone that is the key people press.
- Done: the handle field's key says Send and sends the request; the crew name's Return creates the crew (or moves on to the area for a public crew); the area's Return creates. A second Return or tap while it saves sends no second request and makes no second crew. e2e flow "People: Return on the keyboard sends a friend request and creates a crew, once each".
- Next: keep walking the social screens (a friend's profile, a crew page as a member).

# CALL SHEET

## 2026-11-12 Return sends, once (free roamer B)
- What: Enter in the friend handle field sends the request; Enter in Create crew's fields creates; both guard against a double submit. An empty handle focuses the field instead of doing nothing.
- Why: every messaging and social app sends on the keyboard's Send key; a silent Return looked broken, and a double Return could have made two crews.
- Undo: remove the keydown listeners and guards in web/cockpit.js (search "the phone keyboard's Send key" and "Return on the keyboard").
