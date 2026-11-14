# STATE

## 2026-11-14: A saved route keeps the members' road feel along it
- Done: what members measured along a saved route (`ApexContributor.measuredAlong`: the "Measured by members" line, the driven corners that replace the map's, Q-04, and the bumps several members felt, Q-02) is kept on the phone with the route (`web/route_feel.js`, localStorage `apex.routeFeel`, twenty routes and 400 KB at most), when it is saved and again whenever its card asks with signal. Opened with no signal, the card's line says "(kept 3:04 PM)" or "(kept Nov 13)", and the route's corners and bump calls come from the kept copy. Only the curvature runs `blendCurvature` would take are kept (2+ passes, 30 m), by metres along the route, so a rebuilt track lines up. Unsaving, Delete offline data, sign-out, account deletion and Erase drop it. Tests: tests/test_route_feel.py, e2e "a saved route keeps its road feel…".
- Next: none here.

# CALL SHEET

## 2026-11-14: Road feel kept on the phone only, not on the account
- What: the kept copy lives in its own key, not in the saved route, so it never goes to the account with Saved routes and places on my account.
- Why: it is members' data (cleared on sign-out like the members' cells kept for plans); the account copy of a route is the user's own. Nothing new is sent: the card already asks for it with signal. So the privacy page and APP_REVIEW are unchanged.
- Undo: drop `keepFeelAlong` and the offline `ApexRouteFeel.load` branch in `showMeasured` (web/cockpit.js), and the script tag.
