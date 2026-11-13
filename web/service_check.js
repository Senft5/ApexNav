// Service check (the owner, 2026-11-12: "a service health diagnostic run in the app for me only that sends data back"):
// every server and service the app leans on, asked once from this phone, each with a fixed small request at a fixed
// place (downtown Cincinnati, never where the phone is), timed, and judged up, slow or down with a short reason. The
// owner runs it from Settings (cockpit.js serviceCheckSection: shown only while /api/me says moderator) and the result
// goes to the Worker (POST /api/ops/service-check, backend/src/service_check.ts), which keeps it in D1 error_counts
// (kind 'service') so an agent with D1 access reads what the phone saw. Our router is asked for a real Fun, Long way and
// loop plan through the app's own worker, so "check signal" can be told apart from a dead router.
// (Our own server is asked about whole 0.1° cells only, as everywhere: tests/test_position_beacon.py.)
// Pure over injected fetch, clock and router (tests/test_service_check.py); the page lends them (cockpit.js).
(function (root) {
  'use strict';
  const AT = { lat: 39.1031, lon: -84.5120 };                 // downtown Cincinnati: inside the shipped road graph
  const TO = { lat: 39.0790, lon: -84.2280 };                 // ~25 km east, still inside it
  const CAM_TILE = '156_-339';                                 // cameras.js 0.25° tile holding AT
  const TIMEOUT_MS = 15000, ROUTER_MS = 45000, SLOW_MS = 4000;
  const VALHALLA = 'https://valhalla1.openstreetmap.de';
  const OVERPASS = [['overpass_de', 'overpass-api.de'], ['overpass_kumi', 'overpass.kumi.systems'], ['overpass_coffee', 'overpass.private.coffee'],
    ['overpass_vk', 'maps.mail.ru', '/osm/tools/overpass/api/interpreter']];

  // id, name, what it feeds (shown under a service that is down), and the request. `api: true` goes through the page's
  // apiFetch (our Worker, with the session); otherwise a plain fetch with no credentials.
  const json = (j) => j && typeof j === 'object';
  // the build's date, not its id (a long id reads as a token and the server's scrub blanks it)
  const built = (j) => String(j.built || '').slice(0, 10) || '?';
  const cams = (n) => `${n} camera${n === 1 ? '' : 's'} in the test tile`;
  // the region index's tile nearest the test place (any listed one when that isn't), so a real tile is fetched
  async function firstTile(deps) {
    const r = await deps.fetch(`${deps.apiBase || ''}/api/graph/v1/index.json`, { credentials: 'omit' });
    const j = r && r.ok ? await r.json() : null;
    const names = j && j.tiles ? Object.keys(j.tiles) : [];
    if (!names.length) throw new Error('the region index lists no tiles');
    const here = `${Math.floor((AT.lon + 180) / 0.25)}_${Math.floor((AT.lat + 90) / 0.25)}`;
    return `/api/graph/v1/${names.includes(here) ? here : names[0]}.vgr`;
  }
  const PROBES = [
    { id: 'api', group: 'Vetta servers', name: 'Server and database', feeds: 'sign-in, friends, crews, hazards, sharing',
      api: true, path: '/api/health', check: (j) => (json(j) && j.ok && j.db ? null : 'database not answering') },
    { id: 'api_direct', group: 'Vetta servers', name: 'Server, asked straight from the page', feeds: 'road graph tiles (they skip the app\'s own connection)',
      worker: true, path: '/api/health', check: (j) => (json(j) && j.ok ? null : 'database not answering') },
    { id: 'session', group: 'Vetta servers', name: 'Your sign-in', feeds: 'everything members-only', api: true, path: '/api/me',
      check: (j) => (!json(j) ? 'no answer' : !j.signed_in ? 'not signed in' : !j.member ? 'signed in, not a member' : null) },
    { id: 'flags', group: 'Vetta servers', name: 'Feature flags', feeds: 'own routing on or off, rollouts', api: true, path: '/api/flags',
      check: (j) => (json(j) ? null : 'no flags') },
    { id: 'hazards', group: 'Vetta servers', name: 'Hazard and police reports', feeds: 'hazards on the map, Avoid police', api: true,
      path: '/api/hazards?lat=39.1&lon=-84.5&km=5', check: (j) => (Array.isArray(j) ? null : 'not a list') },
    { id: 'roads', group: 'Vetta servers', name: 'Measured roads', feeds: 'road feel, coverage', api: true,
      path: '/api/coverage?bbox=39.1,-84.6,39.2,-84.5', check: (j) => (json(j) ? null : 'no answer') },
    { id: 'ctx_keys', group: 'Vetta servers', name: 'Route context keys', feeds: 'events, work zones, photos along a route', api: true,
      path: '/api/ctx/keys', check: (j) => (json(j) ? null : 'no keys') },
    { id: 'osm_relay', group: 'Vetta servers', name: 'Map features relay', feeds: 'route context (OSM features)', api: true,
      path: `/api/ctx/osm?bbox=${[39.10, -84.55, 39.15, -84.50].join(',')}`, soft: { 504: 'up, but still fetching from Overpass' }, check: (j) => (json(j) && Array.isArray(j.elements) ? null : 'no elements') },
    { id: 'graph_index', group: 'Our router', name: 'Road graph index (region)', feeds: 'Fun, Long way and loops outside Cincinnati',
      worker: true, path: '/api/graph/v1/index.json',
      check: (j) => (json(j) && j.tiles && Object.keys(j.tiles).length ? null : 'index has no tiles'), note: (j) => (json(j) && j.tiles ? `${Object.keys(j.tiles).length} tiles, built ${built(j)}` : '') },
    { id: 'graph_tile', group: 'Our router', name: 'Road graph tile (region)', feeds: 'Fun, Long way and loops outside Cincinnati',
      worker: true, bytes: true, pathOf: firstTile, check: (n) => (n > 64 ? null : 'empty tile') },
    { id: 'graph_bundled', group: 'Our router', name: 'Road graph shipped in the app', feeds: 'Fun, Long way and loops around Cincinnati',
      local: true, path: 'data/graph/v1/index.json', check: (j) => (json(j) && j.tiles && Object.keys(j.tiles).length ? null : 'index has no tiles'),
      note: (j) => (json(j) && j.tiles ? `${Object.keys(j.tiles).length} tiles, built ${built(j)}` : '') },
    { id: 'router_fun', group: 'Our router', name: 'Fun plan', feeds: 'Fun routes', router: 'fun' },
    { id: 'router_long', group: 'Our router', name: 'Long way plan', feeds: 'Long way routes', router: 'max' },
    { id: 'router_loop', group: 'Our router', name: 'Loop plan', feeds: 'loops', router: 'loop' },
    { id: 'valhalla', group: 'Outside services', name: 'Valhalla', feeds: 'Quick routes, turn instructions', url: `${VALHALLA}/route`, method: 'POST',
      body: JSON.stringify({ locations: [AT, TO], costing: 'auto', directions_options: { units: 'kilometers' } }),
      check: (j) => (json(j) && j.trip && j.trip.status === 0 ? null : json(j) && j.error ? String(j.error).slice(0, 80) : 'no trip') },
    { id: 'osrm', group: 'Outside services', name: 'OSRM', feeds: 'the last-resort Quick route',
      url: `https://router.project-osrm.org/route/v1/driving/${AT.lon},${AT.lat};${TO.lon},${TO.lat}?overview=false`,
      check: (j) => (json(j) && j.code === 'Ok' ? null : json(j) && j.code ? String(j.code) : 'no route') },
    { id: 'cameras_region', group: 'Camera map', name: 'Our camera list (OH, KY, IN)', feeds: 'plate readers and speed cameras, Avoid cameras, in our region',
      worker: true, path: '/api/cameras/v1/region.json',
      check: (j) => (json(j) && Array.isArray(j.tiles) && Array.isArray(j.cams) && j.cams.length ? null : 'no cameras in the list'),
      note: (j) => (json(j) && Array.isArray(j.cams) ? `${j.cams.length.toLocaleString('en-US')} cameras, ${j.tiles.length} tiles` : '') },
    ...OVERPASS.map(([id, host, path = '/api/interpreter']) => ({ id, group: 'Camera map', name: `Overpass (${host})`, feeds: 'plate readers and speed cameras, Avoid cameras',
      url: `https://${host}${path}`, method: 'POST', form: true, camera: true,
      check: (j) => (!json(j) || !Array.isArray(j.elements) ? 'not an Overpass answer' : j.remark && /error|timed out/i.test(j.remark) ? String(j.remark).slice(0, 80) : null),
      note: (j) => (json(j) && Array.isArray(j.elements) ? cams(j.elements.length) : '') })),
    { id: 'cameras_app', group: 'Camera map', name: 'Camera map as the app asks it', feeds: 'the "Camera map offline" note', cameras: true },
    { id: 'map_style', group: 'Outside services', name: 'Map style (OpenFreeMap)', feeds: 'the map itself', url: 'https://tiles.openfreemap.org/styles/liberty',
      check: (j) => (json(j) && j.sources ? null : 'no style') },
    { id: 'map_tiles', group: 'Outside services', name: 'Map tiles (OpenFreeMap)', feeds: 'the map itself, the road names', url: 'https://tiles.openfreemap.org/planet',
      check: (j) => (json(j) && Array.isArray(j.tiles) && j.tiles.length ? null : 'no tile list') },
    { id: 'terrain', group: 'Outside services', name: 'Terrain tiles', feeds: 'hills, crests, elevation', url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/272/391.png',
      bytes: true, check: (n) => (n > 100 ? null : 'empty tile') },
    { id: 'search', group: 'Outside services', name: 'Search (Photon)', feeds: 'Where to? search', url: `https://photon.komoot.io/api/?q=Cincinnati&limit=1`,
      check: (j) => (json(j) && Array.isArray(j.features) ? null : 'no results') },
    { id: 'nominatim', group: 'Outside services', name: 'Search (Nominatim)', feeds: 'search fallback, place names',
      url: `https://nominatim.openstreetmap.org/reverse?format=json&lat=${AT.lat}&lon=${AT.lon}&zoom=10`, check: (j) => (json(j) && !j.error ? null : 'no place') },
    { id: 'weather', group: 'Outside services', name: 'Forecast (Open-Meteo)', feeds: 'weather along the route',
      url: `https://api.open-meteo.com/v1/forecast?latitude=${AT.lat}&longitude=${AT.lon}&hourly=temperature_2m&forecast_days=1`,
      check: (j) => (json(j) && j.hourly ? null : 'no forecast') },
    { id: 'nws', group: 'Outside services', name: 'Weather now (NWS)', feeds: 'the place plate\'s weather', url: `https://api.weather.gov/points/${AT.lat},${AT.lon}`,
      check: (j) => (json(j) && j.properties ? null : 'no point') },
  ];

  const errText = (e) => {
    const m = String((e && (e.name === 'AbortError' || e.name === 'TimeoutError') && 'timed out') || (e && e.message) || e || 'failed');
    return m.slice(0, 120);
  };
  /** A result: { id, state: 'up' | 'slow' | 'down', http, ms, detail }. */
  function judge(id, { ok, http = null, ms, detail = '' }, slowMs = SLOW_MS) {
    return { id, state: !ok ? 'down' : ms > slowMs ? 'slow' : 'up', http, ms: Math.round(ms), detail: String(detail || '').slice(0, 160) };
  }

  async function timed(fn, ms, now) {
    const t0 = now();
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const late = new Promise((_, no) => { timer = setTimeout(() => { if (ctrl) ctrl.abort(); no(Object.assign(new Error('timed out'), { name: 'TimeoutError' })); }, ms); });
    try { return { v: await Promise.race([fn(ctrl ? ctrl.signal : undefined), late]), ms: now() - t0 }; }
    catch (e) { return { e, ms: now() - t0 }; }
    finally { clearTimeout(timer); }
  }

  /** One probe over deps: { fetch, apiFetch, plan(level) , loops(), cameras(), cameraQuery(tile), now, timeoutMs }. */
  async function probe(p, deps) {
    const now = deps.now || (() => Date.now());
    if (p.router) {
      if (!deps.plan) return { id: p.id, state: 'skip', http: null, ms: 0, detail: 'our router is not loaded on this page' };
      const r = await timed(() => (p.router === 'loop' ? deps.loops() : deps.plan(p.router)), deps.routerMs || ROUTER_MS, now);
      if (r.e) return judge(p.id, { ok: false, ms: r.ms, detail: errText(r.e) }, 20000);
      const v = r.v || {};
      const n = Array.isArray(v.cands) ? v.cands.length : Array.isArray(v) ? v.length : 0;
      const why = v.reason && v.reason !== 'ok' ? `reason ${v.reason}${v.error ? `: ${v.error}` : ''}` : '';
      return judge(p.id, { ok: n > 0, ms: r.ms, detail: n > 0 ? `${n} route${n === 1 ? '' : 's'}` : why || 'no routes' }, 20000);
    }
    if (p.cameras) {
      if (!deps.cameras) return { id: p.id, state: 'skip', http: null, ms: 0, detail: 'camera module not loaded' };
      const r = await timed(() => deps.cameras(CAM_TILE), deps.timeoutMs || TIMEOUT_MS * 2, now);
      if (r.e) return judge(p.id, { ok: false, ms: r.ms, detail: errText(r.e) });
      return judge(p.id, { ok: Array.isArray(r.v), ms: r.ms, detail: Array.isArray(r.v) ? cams(r.v.length) : 'no server answered (the app shows "Camera map offline")' });
    }
    const init = { method: p.method || 'GET' };
    if (p.form) { init.body = 'data=' + encodeURIComponent(deps.cameraQuery ? deps.cameraQuery(CAM_TILE) : ''); init.headers = { 'content-type': 'application/x-www-form-urlencoded' }; }
    else if (p.body) { init.body = p.body; init.headers = { 'content-type': 'application/json' }; }
    const go = async (signal) => {
      const path = p.pathOf ? await p.pathOf(deps) : p.path;
      if (p.api) return deps.apiFetch(path, { ...init, signal });
      const url = p.worker ? `${deps.apiBase || ''}${path}` : p.local ? path : p.url;
      return deps.fetch(url, { ...init, signal, credentials: 'omit', cache: 'no-store' });
    };
    const r = await timed(async (signal) => {
      const res = await go(signal);
      if (!res) return { http: null, body: null };
      let body = null;
      try { body = p.bytes ? (await res.arrayBuffer()).byteLength : await res.json(); } catch (_) { body = undefined; }
      return { http: res.status, okHttp: res.ok, body };
    }, deps.timeoutMs || TIMEOUT_MS, now);
    const slow = deps.slowMs || SLOW_MS;
    if (r.e) return judge(p.id, { ok: false, ms: r.ms, detail: errText(r.e) }, slow);
    const { http, okHttp, body } = r.v;
    if (http == null) return judge(p.id, { ok: false, ms: r.ms, detail: 'no response' }, slow);
    // an answer that says the service works but its own upstream is slow (the relay waiting on Overpass)
    if (!okHttp && p.soft && p.soft[http]) return { id: p.id, state: 'slow', http, ms: Math.round(r.ms), detail: p.soft[http] };
    if (!okHttp) return judge(p.id, { ok: false, http, ms: r.ms, detail: `HTTP ${http}${json(body) && body.error ? ` ${String(body.error).slice(0, 60)}` : ''}` });
    if (body === undefined) return judge(p.id, { ok: false, http, ms: r.ms, detail: p.bytes ? 'unreadable body' : 'not JSON' });
    const bad = p.check ? p.check(body) : null;
    return judge(p.id, { ok: !bad, http, ms: r.ms, detail: bad || (p.note ? p.note(body) : '') }, slow);
  }

  // A probe the page was hidden through is not judged: a phone that locks or leaves the app stops its timers and its
  // worker, and on return every timer fires at once, so the router reported "graph router timed out" after 544 s
  // (Nate's runs, 2026-11-12/13) when nothing was wrong with it. deps.away() counts the times the page went hidden,
  // deps.hidden() says whether it is hidden now (hidden at the start or the end counts too).
  async function fairProbe(p, deps) {
    const now = deps.now || (() => Date.now());
    const hid = () => !!(deps.hidden && deps.hidden());
    const a0 = deps.away ? deps.away() : 0, h0 = hid(), t0 = now();
    const r = await probe(p, deps).catch((e) => judge(p.id, { ok: false, ms: now() - t0, detail: errText(e) }));
    if (h0 || hid() || (deps.away && deps.away() !== a0)) return { id: p.id, state: 'skip', http: null, ms: r.ms, detail: 'the app was in the background, so not judged' };
    return r;
  }

  /** Every probe at once (the router ones one after another, after the rest: they share one worker). */
  async function run(deps, only) {
    const list = PROBES.filter((p) => !only || only.includes(p.id));
    const plain = list.filter((p) => !p.router), routers = list.filter((p) => p.router);
    const out = await Promise.all(plain.map((p) => fairProbe(p, deps)));
    for (const p of routers) out.push(await fairProbe(p, deps));
    const order = new Map(PROBES.map((p, i) => [p.id, i]));
    return out.sort((a, b) => order.get(a.id) - order.get(b.id));
  }

  /** "iPhone app 1.0 (384)" bits from the user agent the iOS shell sets (feedback.js reads the same). */
  function appOf(ua) {
    const m = /ApexNav\/([\d.]+)\s*\((\d+)\)/.exec(String(ua || ''));
    return m ? { app: 'ios', version: m[1], build: m[2] } : { app: 'web', version: '', build: '' };
  }
  /** The report the Worker keeps: no place but the fixed test one, no person. */
  function report(results, env = {}) {
    const a = appOf(env.ua);
    return { ...a, online: env.online === false ? false : true, results: results.map(({ id, state, http, ms, detail }) => ({ id, state, http, ms, detail })) };
  }
  /** One line for the whole run: "24 up, 1 slow, 2 down: Overpass (overpass-api.de), Fun plan". */
  function summary(results) {
    const by = (s) => results.filter((r) => r.state === s);
    const name = (id) => (PROBES.find((p) => p.id === id) || { name: id }).name;
    const down = by('down');
    return [`${by('up').length} up`, by('slow').length ? `${by('slow').length} slow` : null, `${down.length} down`].filter(Boolean).join(', ')
      + (down.length ? `: ${down.map((r) => name(r.id)).join(', ')}` : '');
  }

  const api = { PROBES, AT, TO, CAM_TILE, SLOW_MS, probe, run, judge, report, summary, appOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexServiceCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
