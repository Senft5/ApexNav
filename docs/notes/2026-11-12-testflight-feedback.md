# STATE

## Session 2026-11-12 (TestFlight 01:29): viewpoint stamps say VIEW, the name close in (claude/project-thread-0wt1zm)

- Owner note 01:29:22Z "bird watching shelter blocks half the route" (a named viewpoint's label across a loop preview).
- web/cockpit.js attachScenic: the view stamp is SCENIC_LABEL.view; declutterPois sets a named viewpoint's text to its name
  at zoom >= VIEW_NAME_ZOOM (15), before measuring for the declutter. Tap behaviour unchanged.
- Tests: e2e "stamps along a route never pile up" (VIEW at the route's zoom, the name at 15.5).
- The hourly TestFlight run lives in thread "Pull TestFlight feedback every hour" (scheduled task at :52 UTC).

# CALL SHEET

## 2026-11-12 (TestFlight 01:29): a viewpoint on the route is a VIEW stamp, its name close in (claude/project-thread-0wt1zm)

Your note "bird watching shelter blocks half the route". A named viewpoint's stamp carried its whole name at every zoom and sat
over the line. Now it says VIEW, like CAFÉ and FUEL, and shows its name only at zoom 15 or closer; a tap on it (or its row
under Along the route) still says the name and offers it as a stop. Undo: revert the PR (or lower VIEW_NAME_ZOOM in cockpit.js).
