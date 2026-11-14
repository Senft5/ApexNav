# STATE

## A friend's drives on their profile (2026-11-14)
A tap on a friend (People, or their name on a post) opens their profile, which now shows their newest drive posts you
can see, as Feed cards with kudos and comments. `GET /api/feed?author=<user id>` (backend/src/drive_posts.ts, the Feed's
POST_SEEN rules, so a crew post shows only to that crew's members); `web/drive_posts.js` `drivesOf`; `web/cockpit.js`
openProfile puts it in the profile's extra rows. Tests: backend drive_posts.test.ts, e2e "drive posts: …".
Next: a See all on the profile when a friend has more than three posts.
