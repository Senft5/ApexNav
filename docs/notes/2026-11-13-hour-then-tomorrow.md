# STATE

## 2026-11-13 When to go says "2:00 PM tomorrow" (claude/project-thread-5sbga7)
- Done: the route card's When to go line read "Better at tomorrow 2:00 PM: no school run". The hour now comes first and the day after it, so every sentence the clock goes into reads: "Better at 2:00 PM tomorrow", "Leave by 2:00 PM tomorrow", "Plan for 2:00 PM tomorrow", "Open from 2:00 PM tomorrow".
- Tests: pytest; e2e "when to go" (its key check now pins the order), "Settings behind the gear", "privacy".
- Done: Settings → Privacy zones and Spots: their size and detour pickers had no name on the screen (three bare distances; Off / Little / Some / More). Each now has a small label over it, as Units' Driving side does: "Size of a new zone", "How far loops go out of their way".
- Done: Settings → Your data ended with a sentence to follow by hand, "To delete your account…: Settings → Account → Delete account." It is now a Delete account row under Remove that opens Account (signed in only; the delete itself still asks there). docs/APP_REVIEW.md 5.1.1(v) names it. New e2e flow "Your data: Delete account is a row".
- Next: keep sweeping the route card and Settings.

# CALL SHEET

## 2026-11-13 whenClock puts the day after the hour
- What: cockpit.js whenClock returns "2:00 PM tomorrow" instead of "tomorrow 2:00 PM".
- Why: "Better at tomorrow 2:00 PM" and "Open from tomorrow 2:00 PM" are not English; the hour-first form fits every caller.
- Undo: swap the two parts of whenClock back and the e2e key regex.

## 2026-11-13 the zone size and spot detour pickers are labelled
- What: index.html: a small note line over #zoneRadius and #detourList (aria-hidden; the groups' aria-labels say the same).
- Why: the guide's labelled-numbers rule; a row of bare distances did not say it was the size of the next zone.
- Undo: delete the two note lines.

## 2026-11-13 Your data's Delete account row goes to Account
- What: index.html #myAccountDelGo in the Remove group (hidden until /api/me says signed in, cockpit.js renderAccount); a tap closes Your data and opens Account (ApexGarageSettings.ui).
- Why: a way there instead of directions to read; one place still does the deleting.
- Undo: delete the row and its two cockpit.js lines, and put the note back.
