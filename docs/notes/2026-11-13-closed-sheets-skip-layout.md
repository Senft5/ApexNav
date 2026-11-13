# STATE

## 2026-11-13 Native speed, step 1: closed sheets skip layout (claude/project-thread-5sbga7)
- Done: big bet #10 (docs/notes/2026-11-13-big-bets.md). Measured first: cold start to a usable map at 4x CPU (a mid-range phone) is about 1.0-1.2 s, and a bundle or minifying does not move it (124 scripts, every script minified, and one minified bundle all came out at ~1.0 s: in the app the files are local, requests cost ~50 ms and compiling ~20 ms). The time is startup code (~440 ms) and style and layout (~400 ms, two full passes). This step: a closed sheet or side sheet (the Garage and its Settings pages, Options, People) is no longer styled or laid out (content-visibility: hidden, switched after the close slide). Alternating runs, 8 each at 4x CPU: ready 1168 -> 1035 ms median, layout 190 -> 115 ms, style 200 -> 135 ms. The look picker no longer measures itself at boot (a forced 25 ms layout); it turns to the look in use when the Garage opens.
- Tests: the e2e startup budget now checks every closed sheet skips layout and prints layout and style time; full e2e locally (four shards at once on four cores: six timing flows failed under that load and passed one by one); pytest.
- Next: build the Garage, Settings and the look picker on first open instead of at boot; the map's first measure forces a full layout (63 ms); a cold-start time check at 4x CPU in CI.

# CALL SHEET

## 2026-11-13 closed sheets are content-visibility: hidden
- What: index.html `.sheet:not(.open), .side-pop:not(.open) { content-visibility: hidden }` with a 0.2 s discrete transition so the close slide still shows its contents; cockpit.js shelveLooks runs only on the Garage (showView calls it).
- Why: about 130 ms of a ~1.1 s cold start went to laying out sheets nobody had opened. A browser without content-visibility lays them out as before.
- Undo: delete the rule and the `view !== 'garage'` guard.
