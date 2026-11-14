# STATE

## 2026-11-14 Drive it on a drive post

- **Done:** a drive post in the Feed (a friend's or your own) now has a **Drive it** key beside Kudos and Comment, on any
  post with a line. One tap closes the Feed and lays a route along the post's line, named for the drive, with a toast
  saying whose line it is ("Cherohala Skyway, @bob's line: 13.7 mi"). Seeing a friend's great drive and driving it
  yourself was missing: posts had no way into routing at all.
  - `web/drive_posts.js` `throughPoints(pts, 12)` picks stops evenly by distance along the line (one per ~1.5 km, 2 to
    12, both ends kept); `web/cockpit.js` `driveLine` sends them to `buildRoute`, the same through-stops path as a shared
    maps link's stops or a GPX file's route points (our own router first).
  - New e2e flow "drive posts: Drive it on a friend's post…".
- **Active bugs:** none known.
- **Next:** a tap on a stage row of a post could do the same for just that stage (needs the stage's ends on the post).

# CALL SHEET

## 2026-11-14 A post's line is routed through, not driven as drawn

- **What:** Drive it routes through up to 12 stops on the line instead of following the line itself (as a roadbook road
  or a time attack loop is).
- **Why:** a post's line is thinned to at most 600 points, often 60 to 120 m apart, so driven as drawn its corners
  would be chords and the pace notes wrong. Stops on the line keep the route on the friend's roads, and the notes come
  from real road geometry. Like other through-stop routes, it uses our router first.
- **Undo:** drop `driveLine` from the drive posts mount in cockpit.js (the key hides itself without it).
