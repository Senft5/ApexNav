# STATE

## 2026-11-14: Your data counts the car map's offline copy
- Done: the car map's own offline packs (CarPlay/ApexCarOffline.swift, #772) fetch the saved areas a second time, and Garage → Your data didn't count them. The shell now tells the page what our packs hold (`type: "carOffline"`, bytes completed). It reports when the list is reconciled, at most every 5 s while packs download, and again whenever the page loads. Your data's offline line then adds "the car map's copy N MB". Off the app, or before a car has ever connected, the line says nothing about it (unknown or none). Tests: tests/test_my_data.py, tests/test_offline_tiles.py, an extra step in e2e "offline area: Save the map here…".
- Next: none here.
