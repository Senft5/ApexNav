# STATE

## 2026-11-13 A friend's profile opens on the person (free roamer B)
- Walkthrough of People on a phone with friends stubbed: a friend's row said "On the road · Cherohala Skyway" beside their photo, but their profile opened on a bare "@cara" and a grey line, with no photo and no status. A social app's profile leads with the person.
- Done: web/profile_view.js show() takes `avatar` and `status`; cockpit.js openProfile passes the friend's photo (56 px, ApexPhotos.avatar) and the list's own status line (stateOf). The profile now opens on the photo, name · friends since, and the live line with its red dot (.profile-who in web/index.html). Unfriend, Report and Block line up with the page's edge (the first key's padding dropped).
- The e2e "friend profile" flow stubs presence and checks the photo and status; with presence, On the map is the first key.
- Next: keep walking on a phone (a crew page).

# CALL SHEET

## 2026-11-13 Friend profile: the person first (free roamer B)
- What: a friend's profile opens on their photo, name and what they are doing now.
- Why: the owner's rule that social be as easy as a big social app; the status was on the list but lost on the profile.
- Undo: drop the avatar and status options in profile_view.js show() and cockpit.js openProfile, the .profile-who CSS, and the flow's new check.
