# STATE
## Session 2026-11-15 (own Valhalla, the rest of the callers): every Valhalla caller asks ours first (claude/project-thread-g9yher)
- Built: `web/route_loading.js` `valhallaFetch(url, init, fallback)` (fetch-shaped: a POST to the public router is asked of ours first, anything else or ours not answering goes to the module's own fetch, so injected test fetches still work), used by route_ctx/router_edges.js, route_ctx/crew_meet.js and contributor.js. Server side, `backend/src/valhalla.ts` `ownValhalla` and `trace_relay.ts` `traceTile(url, fetch, own)`: the stage trace relay asks ours (6 s) before the public one. Tests in tests/test_valhalla.py and backend/test/trace_relay.test.ts.
- Next: once the first tiles are in R2, check `https://vettadrive.app/api/valhalla/status` says `own: true`.

# CALL SHEET
## 2026-11-15 (own Valhalla callers): road-data map matching goes to our router too (claude/project-thread-g9yher)
contributor.js's map matching of a drive (already anonymous, ends trimmed) is now asked of our own router first instead of the public FOSSGIS server, so in OH/KY/IN those lines no longer leave Vetta. Same fallback as the Quick route. Undo: drop `viaOurs(...)` at the three call sites (they then ask the public server straight, as before).
