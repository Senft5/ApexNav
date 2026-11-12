# STATE

## Session 2026-11-12 (TestFlight 01:29): viewpoint stamps say VIEW, the name close in (claude/project-thread-0wt1zm)

- Owner note 01:29:22Z "bird watching shelter blocks half the route" (a named viewpoint's label across a loop preview).
- web/cockpit.js attachScenic: the view stamp is SCENIC_LABEL.view; declutterPois sets a named viewpoint's text to its name
  at zoom >= VIEW_NAME_ZOOM (15), before measuring for the declutter. Tap behaviour unchanged.
- Tests: e2e "stamps along a route never pile up" (VIEW at the route's zoom, the name at 15.5).
- The hourly TestFlight run lives in thread "Pull TestFlight feedback every hour" (scheduled task at :52 UTC).

## Session 2026-11-12 (TestFlight 02:30 to 02:48): meeting points switch, Pace vs Sight; the rest handed on (claude/project-thread-0wt1zm)

- 02:35 "meeting points switch broken": web/crew_page.js meetShare took the square only from a pinned Home and otherwise
  refused with a toast. Now Home, else the phone's current position's 0.1-degree square (geolocation, 8 s); 401 says sign in.
  privacy.html says so. e2e crew page flow (geolocation granted): the switch turns on and sends the square's centre.
- 02:30 "why pace and sight different?": web/cockpit.js sets the cluster's paceMph to the lower of the corner's pace and the
  held Sight (unless Sight is Open), so the gauge's PACE, its lamp and the needle's red read the one speed to drive to.
- 02:45 to 02:48, eight notes ("cluttered", "walls of text", "ai slop") on Garage, Crews, the Log list, Your driving (x2),
  Ways to go, the map deck and Where to?: the UI thread took all eight (small PRs, one per screen).
- 02:33 time attack loop "an hour away" and "only through a neighborhood": the social thread (owner of #433's picker).



# CALL SHEET

## 2026-11-12 (TestFlight 01:29): a viewpoint on the route is a VIEW stamp, its name close in (claude/project-thread-0wt1zm)

Your note "bird watching shelter blocks half the route". A named viewpoint's stamp carried its whole name at every zoom and sat
over the line. Now it says VIEW, like CAFÉ and FUEL, and shows its name only at zoom 15 or closer; a tap on it (or its row
under Along the route) still says the name and offers it as a stop. Undo: revert the PR (or lower VIEW_NAME_ZOOM in cockpit.js).

## 2026-11-12 (TestFlight 02:30 to 02:48): your meeting points switch and PACE vs Sight (claude/project-thread-0wt1zm)

Meeting points: with no Home pinned, the switch now shares the rough square you are in when you turn it on (the same
11 km square, never the spot) instead of refusing; the privacy page says so. Undo: revert, and it needs Home again.
PACE vs Sight: they were two limits, the corner's and the view's. The gauge's PACE is now the lower of the two, the speed
to drive to, so it matches Sight when the view is what limits you. Undo: drop the one line in cockpit.js.
