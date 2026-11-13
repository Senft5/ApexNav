# STATE

## 2026-11-13: first fixes from Apple's accessibility audit
- Run 8 of the App tour recording listed 27 issues, each now with the element's type and frame (`[type N x,y WxH]`, 9 = button, 48 = static text).
- Fixed: the map credit key is 44 pt to touch and named "Map credits" (its drawn "i" had stood in for its name, with a 4 pt frame); the Log page's tab links carry their names, so their 14 pt labels are no longer the touch targets; Terms and Privacy under the sign-in keys are 44 pt tall to touch.
- Left: static text inside the People sign-in rows and the Garage look cards ("A time, a meeting point...", "Marguerite", "In use") flagged as small hit regions. They are not controls; the next run says whether WebKit still reports them as tappable.
- Next: run the App tour recording again on main and compare.

# CALL SHEET

## 2026-11-13: credit key named in the page, not in MapLibre
- What: cockpit.js names `.maplibregl-ctrl-attrib-button` "Map credits"; the CSS "i" has empty alt text (`content: "i" / ""`).
- Why: the audit read the drawn "i" as the key's label and frame.
- Undo: drop the line after `let attribAsked` and the second `content`.
