# STATE

## 2026-11-14: Where to? with one bar suggests the kept map's places
- Done: until now, when the map search failed, Where to? looked on the map kept on the phone (cockpit `mapSuggest`: towns and places round you) only if the phone said it was offline. With one bar that carries nothing, it now looks there too, so typing a town in a dead zone still suggests it. The "Suggestions didn't load" note stays for when nothing matches. Test: an extra step in e2e "Where to? with no signal…".
- Next: none here.
