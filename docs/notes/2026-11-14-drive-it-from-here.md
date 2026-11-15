# STATE

## 2026-11-14 Drive it leads from where you are (free roamer B)
- Done: Drive it on a friend's posted drive (and on a posted stage) now routes from where you are to the start of their line, then along it, the same way Best roads nearby drives a stage. The toast says how far it is to the start and how long their line is. The route keeps a request with shaping stops on their line, so a reroute stays on it.
- Test: e2e flow "drive posts: Drive it from somewhere else" (fails on main).
- Next: none queued here.

# CALL SHEET

## 2026-11-14 No lead-in when you're close or very far (free roamer B)
- What: Drive it adds the leg from your location only when you are 300 m to 150 km from the line's start; closer, the route starts at their line; farther or with no location, it is their line alone.
- Why: under 300 m the extra leg is noise; over 150 km it is a road trip, not a lead-in.
- Undo: drop `lead` in `driveLine` in web/cockpit.js.
