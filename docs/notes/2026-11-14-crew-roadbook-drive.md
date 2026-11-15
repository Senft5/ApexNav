# STATE

## 2026-11-14 A crew roadbook's road becomes a crew drive in one tap (free roamer B)
- Done: each road of a crew's roadbook (#844) has Crew drive next to Drive it. It goes to People → Crews and opens the
  crew's plan form named after the road, with "Add the road (Cherohala Skyway)" on, so Plan it shares the road with the
  crew as the drive's route (the same POST /api/routes a planned route takes). Keeping roads together now leads to
  driving them together.
- Also fixed: since #809 the crew page's `onPlan` sat inside a code comment in web/cockpit.js, so the crew page's own
  "Plan one" key (its fallback without the Crew drives section) never drew; it is a real key again.
- Code: web/crew_events.js (`planForm` preset, `plan(crewId, preset)` says whether a form opened), web/cockpit.js
  `planCrewDrive`, web/roadbooks.js road keys. No migration.
- Tests: e2e "roadbooks: a crew's roadbook" (Crew drive opens the form with the road; fails on main).
- Next: a crew drive planned from a book road could show the book on its card.
