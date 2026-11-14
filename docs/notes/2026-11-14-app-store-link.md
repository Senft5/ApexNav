# STATE

## Get the app on invite links (2026-11-14)
An invite, crew, convoy or roadbook link opened in iPhone Safari already offers "Have the app? Open it there". Beside it
now sits "Get the app": the App Store, tagged `ct=invite`, `crew`, `convoy` or `route-share` (the launch marketing
thread's campaign links: App Store Connect counts them, no SDK). Hidden until `APP_STORE_ID` and `APP_STORE_PT` in
`web/cockpit.js` are set (docs/OWNER_TODO.md). Test: tests/test_app_store_link.py.

# CALL SHEET

## Campaign tags, no tracking SDK (2026-11-14)
What: App Store campaign links (`pt`, `ct`) on the invite bar's Get the app, nothing else. Why: App Store Connect counts
them itself, so nothing about the person is sent anywhere by Vetta. Undo: delete the Get the app lines in that block.
