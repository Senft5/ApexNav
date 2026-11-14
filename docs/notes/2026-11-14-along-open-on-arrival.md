# STATE

## 2026-11-14 the Along list says if each stop is open when you'd get there (claude/project-thread-5sbga7)
- Done: on a planned route's Along the route list, each named café and fuel stop now ends with its hours at the time you'd reach it ("Open 24 hours", "On arrival: Closed · opens 6 AM"). The route's time is spread over its length to estimate when you'd reach each one; "On arrival" is added when that is 15 min or more away. One Overpass request for the list (place_info.js lookupMany). Unknown hours add nothing.
- Tests: the e2e "along the route by name" flow checks the Shell says Open 24 hours and the café with no hours says nothing.

# CALL SHEET

## 2026-11-14 along-route hours at the arrival time, not now
- What: status() is asked at now + timeS × (place's distance along / route length).
- Why: a café two hours down the road being open now says little; whether it will be open when you pass is what decides a stop.
- Undo: use `new Date()` in alongHours (cockpit.js), or drop the alongHours call.
