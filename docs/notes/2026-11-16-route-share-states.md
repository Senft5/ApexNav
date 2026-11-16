# STATE

## 2026-11-16 Sharing a route: loading, no answer and nobody yet
- Done: a route card's Share loads as its row of chips in outline (not "Loading your friends and crews…"); with no answer it says "Couldn't load your friends and crews." with Try again (it used to say you had nobody to share with); with nobody yet it says so in one line with Find friends. The Shared toast says Social, the tab's name now. e2e "shared routes:" checks the no-answer state.
- Next: keep sweeping Social for the shared states.

## 2026-11-16: the Share panel is a Social module
- What: the panel's code moved from web/cockpit.js to web/route_share.js, in lazy.js's social group, loaded on the first Share.
- Why: the new states pushed the launch to 3,700,697 script bytes, 697 over the startup budget; sharing is a Social action and doesn't need to be at launch.
- Undo: move `ApexRouteShare.open` back inline in the routeShareBtn handler and drop route_share.js from lazy.js.

## 2026-11-16: plan flow (a) pins its clock
- What: the e2e flow "plan flow (a)" now pins the page clock to 2026-11-10 17:00 UTC.
- Why: with no forecast, the ranking reads the sun and the calendar; run at 11:00 UTC (before sunrise) the swap's reason became "Weather ahead" and the check failed, on main too.
- Undo: drop the setFixedTime line at the top of that flow.
