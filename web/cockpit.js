// The cockpit: the phone app's page script (web/index.html), moved out of the HTML (REVIEW_FEEL F-03) so WebKit can
// cache its bytecode and the HTML parses in a fraction of the time. Kept at the indentation it had inline, so the tests
// that lift a function out by its `    function name(` text read it here as they did there.

  (() => {
    'use strict';
    const Core = window.ApexCore, Themes = window.ApexThemes, Inst = window.ApexInstruments, RouteLoading = window.ApexRouteLoading, FunRoute = window.ApexFunRoute;
    const MPH = Core.MPS_TO_MPH;
    const params = new URLSearchParams(location.search);
    const $ = (id) => document.getElementById(id);
    // A tap on a sheet's backdrop closes it only when the press began on the backdrop too. A press on a key inside the
    // sheet that lifts outside it (a drag, or the sheet moving under the finger) makes the browser send the click to the
    // backdrop, their shared parent; that is not a tap on the backdrop and must not shut the sheet.
    function onBackdrop(back, close) {
      let downOnBack = false;
      back.addEventListener('pointerdown', (e) => { downOnBack = e.target === back; });
      back.addEventListener('click', (e) => { const ok = e.target === back && downOnBack; downOnBack = false; if (ok) close(e); });
    }

    // =======================================================================
    // 1. TRACKS — one shape for profiled drives and geometry-only routes.
    //    Physics comes from core/road_dna.py exports or its parity-tested JS port.
    // =======================================================================
    function trackFromDrive(d) {
      const f = Object.fromEntries(d.fields.map((name, i) => [name, i]));
      const col = (name, scale = 1) => (name in f ? d.rows.map(r => (r[f[name]] == null ? null : r[f[name]] * scale)) : null);
      return {
        id: d.id, name: d.name, kind: 'drive',
        subtitle: [d.date ? d.date.slice(0, 10) : '', d.device || ''].filter(Boolean).join(' · '),
        lat: col('lat'), lon: col('lon'), dist: col('distance_m'), elev: col('elevation_m'),
        speedMps: col('speed_mph', 1 / MPH), latG: col('lat_g'), lonG: col('lon_g'), camberDeg: col('camber_deg'),
        envMps: col('target_mph', 1 / MPH), sightM: col('sight_m'), limitMps: col('limit_kph', 1 / 3.6), roughG: col('roughness_rms'),
        events: d.events.map(e => ({ ...e })), sectors: d.sectors, sectorM: d.sector_m || 500, alpr: null
      };
    }

    /** A detected corner as a route's note event (5 m samples). */
    function cornerEventOf(c, lat, lon, dist) {
      const t = Core.paceNoteText(c);
      return { type: 'corner', code: t.code, call: t.call, index: c.apex, dist_m: dist[c.apex], lat: lat[c.apex], lon: lon[c.apex],
               start_m: dist[c.start], end_m: dist[c.end], radius_m: c.radius_m, apex_mph: c.apex_mps * MPH, dir: c.dir,
               severity: c.severity, grade: c.grade, shape: c.shape, caution: c.caution, turn_rad: Math.abs(c.turn_rad), mods: c.mods };
    }
    /**
     * Corners from members' driven paths (IDEAS Q-04): where the crowd measured the curvature (2+ passes, 30 m runs) it
     * replaces the map's, and the route's corner notes and braking envelope are worked out again. Not during a drive (the
     * notes ahead would jump); the route says how much of it was corrected. Returns true when anything changed.
     */
    function applyCrowdCurvature(t, m) {
      if (!t || t.kind !== 'route' || !m || !Array.isArray(m.crowdK) || !Array.isArray(t.kappa) || t.crowdCorrected != null) return false;
      if (window.ApexFlags && !ApexFlags.on('crowd_curvature')) return false;            // switched off on the server (flags.js, IDEAS Y-06)
      const { kappa, replaced } = Core.blendCurvature(t.kappa, m.crowdK, m.crowdKn || []);
      t.crowdCorrected = replaced * 5;
      if (!replaced) return false;
      const ds = new Float64Array(kappa.length).fill(5), sight = Float64Array.from(t.sightM);
      const env = Core.brakingEnvelopeMps(kappa, ds, null, null, undefined, sight);
      const corners = Core.annotateCautions(Core.detectCorners(kappa, ds), env, sight);
      const events = corners.map(c => cornerEventOf(c, t.lat, t.lon, t.dist));
      Core.linkNotes(events);
      t.events = [...events, ...t.events.filter(e => e.type !== 'corner')].sort((a, b) => a.dist_m - b.dist_m);
      t.kappa = Array.from(kappa); t.envMps = Array.from(env);
      try { if (window.ApexRecce) ApexRecce.apply(ApexRecce.load(localStorage), t); } catch (_) {}   // your own recce notes again
      return true;
    }
    /**
     * Bumps several members felt (IDEAS Q-02, roads.ts verifiedBumps) go on the route as pace notes. Unlike the corners this
     * may happen mid-drive: it only adds notes, it never moves one. Once per track. Returns true when anything was added.
     */
    function applyCrowdBumps(t, m) {
      if (!t || t.kind !== 'route' || !m || !Array.isArray(m.crowdBumps) || t.crowdBumps != null || !Array.isArray(t.events)) return false;
      if (window.ApexFlags && !ApexFlags.on('crowd_bumps')) return false;               // switched off on the server (flags.js)
      const add = ApexContributor.bumpEvents(t, m.crowdBumps, t.events);
      t.crowdBumps = add.length;
      if (!add.length) return false;
      t.events = [...t.events, ...add].sort((a, b) => a.dist_m - b.dist_m);
      Core.linkNotes(t.events);
      if (t.marks && window.ApexRoadMarks) t.marks = ApexRoadMarks.unfelt(t.marks, t.events);   // a mapped hump they felt: one call
      return true;
    }
    const ownRouteOfTrack = new WeakMap();                            // a track built from one of our routes -> that route
    async function trackFromPolyline(coords, id, name, sightMs = 4000, o = {}) {
      const tl = typeof tlSpan === 'function' && typeof performance !== 'undefined' ? tlSpan : null, t0 = tl ? performance.now() : 0;
      // (a track built ahead skips the turn: the page's own work is a few ms of resampling, the rest is the worker's, and
      // the turn waited behind the map's frames for 0.1-0.35 s, live 2026-11-07)
      if (!o.ahead) await RouteLoading.yieldToUI();
      const t1 = tl ? performance.now() : 0;
      const rs = Core.resamplePolyline(coords.map(c => c[1]), coords.map(c => c[0]), 5);
      // what's beside the road (stages.js sightOffsets, IDEAS Q-09): open grass lets you see across a bend, woods don't;
      // no tiles or a long trip: the cautious 4 m everywhere. sightMs: how long to wait for the land cover; past it the
      // track is the cautious one, flagged sightPending (the early quickest: the land cover goes on loading for the ranked
      // route, which is then built in full)
      let offsets = null, pending = false;
      try {
        // the early first route (sightMs at most EARLY_SIGHT_MS) doesn't ask at all: with the map tiles cached the land
        // cover is decoded on the page at once, and that held the first route up (live 2026-11-05: the second plan's first
        // route came up 0.1-0.2 s later than the first plan's)
        if (sightMs <= 100) pending = true;
        else if (window.ApexStages && ApexStages.sightOffsets) {
          const got = await Promise.race([ApexStages.sightOffsets(rs.lat, rs.lon).then((v) => ({ v }), () => ({ v: null })), new Promise((r) => setTimeout(() => r(null), sightMs))]);
          pending = got === null; offsets = got ? got.v : null;
        }
      } catch (_) { offsets = null; }
      // curvature, sight, braking envelope and corners in a Web Worker (analysis_client.js, IDEAS P-05); inline without one
      // which side you drive on (driving_side.js, IDEAS U-22): bends toward it are the blind ones
      let side = null;
      try { side = ApexDrivingSide.forRoute(rs.lat[0], rs.lon[0]); } catch (_) { side = null; }
      const t2 = tl ? performance.now() : 0;
      let took = null;
      const { kappa, sight, env, corners } = await ApexAnalysis.analyse(rs.lat, rs.lon, offsets, { side, timing: tl ? (x) => { took = x; } : null });
      const t3 = tl ? performance.now() : 0;
      if (tl && took && Number.isFinite(took.workMs) && took.doneAt != null) tl(`track ${id}: the worker's own work`, took.doneAt - took.workMs, took.doneAt);
      const dist = rs.lat.map((_, i) => i * 5);
      const events = corners.map(c => cornerEventOf(c, rs.lat, rs.lon, dist));
      Core.linkNotes(events);
      if (tl) { tl(`track ${id}: yield`, t0, t1); tl(`track ${id}: resample+sight`, t1, t2); tl(`track ${id}: analyse (worker)`, t2, t3); tl(`track ${id}: corners`, t3); }
      const t = {
        id, name, kind: 'route', subtitle: 'Map only · not yet driven', sightPending: pending,
        lat: rs.lat, lon: rs.lon, dist, elev: null, speedMps: null, latG: null, lonG: null, camberDeg: null,
        envMps: Array.from(env), sightM: Array.from(sight), limitMps: null, kappa: Array.from(kappa), roughG: null,
        events, sectors: null, sectorM: 500, alpr: null
      };
      // one of our routes: attachLimits lays its posted limits from the tiles it was planned on (offline too, after the
      // card); Valhalla's map matching only for lines off our tiles
      const OR = typeof window !== 'undefined' ? window.ApexOwnRouting : null;
      const own = o.route || (OR && OR.routeOfLine ? OR.routeOfLine(coords) : null);
      if (own) ownRouteOfTrack.set(t, own);
      return t;
    }

    // Bundled recordings are demos (Watch a replay), never the person's own drives. They are 1.8 MB of script, so they load
    // only when asked for (Watch a replay, a ?drive= link), not on every start (IDEAS P-06).
    const drives = [];
    // after the next frame, when the page has nothing else to do (or within 2 s): work nobody is waiting to see (REVIEW_FEEL)
    const idle = (fn) => requestAnimationFrame(() => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200)));
    const DEMO_SCRIPTS = ['data/dry_ridge.js', 'data/pebble_ridge.js'];
    let demosLoading = null;
    function loadDemos() {
      // Resolves true once every demo is in `drives`; false on a failed load, which a later call tries again.
      if (!demosLoading) demosLoading = Promise.all(DEMO_SCRIPTS.map((src) => new Promise((done, fail) => {
        const s = document.createElement('script'); s.src = src; s.onload = done; s.onerror = () => { s.remove(); fail(new Error(src)); };
        document.head.append(s);
      }))).then(() => {
        for (const d of window.APEX_DRIVES || []) if (!drives.some(x => x.id === d.id)) drives.push(Object.assign(trackFromDrive(d), { demo: true }));
        return true;
      }, () => { demosLoading = null; return false; });
      return demosLoading;
    }
    let refreshDriveVersion = 0;
    // Your saved drives, as the cockpit uses them: the bumps they confirmed (called on any road) and what the coach found the
    // last time on each corner (spoken on the way in). F-04 / F-08 (REVIEW_FEEL): built in the analysis worker from the
    // drives in IndexedDB (analysis_client.js memory), so no drive's rows are read on this page's thread; a saved drive is a
    // track here only when it is replayed (`want`, a ?drive= link from the Log).
    async function refreshSavedDrives(want = null) {
      if (window.ApexLogHost) ApexLogHost.changed('drives');           // the Log, kept or not, shows them fresh (F-15)
      refreshYourRoads().catch(() => {});                              // panel D-1: the deck's roads follow the Log
      // a new drive's Vetta Score to the crews you share Scores with (crew_page.js publishDrives: the board's totals)
      setTimeout(() => { try { if (accountMe && state.mode !== 'live' && window.ApexCrewPage && ApexCrewPage.publishDrives) ApexCrewPage.publishDrives(apiCall); } catch (_) {} }, 5000);
      const version = ++refreshDriveVersion;
      let m = null;
      try { m = await ApexAnalysis.job('memory', want ? { track: want } : {}); } catch (e) { console.error('road memory', e); return null; }
      if (m.track && !drives.some((d) => d.id === m.track.id && !d.saved)) {
        const i = drives.findIndex((d) => d.id === m.track.id);
        if (i >= 0) drives.splice(i, 1);
        drives.unshift(Object.assign(m.track, { saved: true }));
      }
      if (version !== refreshDriveVersion) return m;
      const ids = new Set(m.ids);
      for (let i = drives.length - 1; i >= 0; i--) if (drives[i].saved && !ids.has(drives[i].id)) drives.splice(i, 1);   // deleted in the Log
      hazardMemory = m.hazards || [];
      roadMemory = m.roadMemory || [];
      passRefs = m.passRefs || [];
      return m;
    }
    let roadMemory = [], hazardMemory = [], passRefs = [];
    const hazardSaid = new Map(), HZ_REPEAT_MS = 5 * 60000, HZ_SAME_SPOT_M = 40;   // confirmed bump id -> when it was last said
    let track = null;

    // =======================================================================
    // 2. STATE + THEME
    // =======================================================================
    const state = {
      mode: 'replay', playing: false, rate: 1, cursorM: 0, cursorIdx: 0, follow: true, bearing: 0,
      live: null, liveAt: 0, lastPosition: null, spiritedAt: -Infinity, spoken: new Set(), tapToRoute: false,
      theme: 'roadbook', camFeel: 'dynamic', voiceId: 'marguerite', voicePick: null, liveVoice: false, voiceStyle: 'codriver', voiceName: '', hlOn: false, hlStrength: 1,
      notesMode: 'auto', nightMode: 'auto', musicMode: 'lower',   // Notes: auto | full | quiet. Night: auto (sunset/sunrise) | on | off
      noteWords: 'plain',                     // rally ("Left 4 minus") | plain ("Medium left"), IDEAS V-02; a saved setting wins
      toggles: { stage: false, voice: true, lpr: true, roadcams: false, dna: false, night: false, twisty: true, haptics: true, soundtrack: false, crash: true, drivecam: false, health: true, terrain: false, coverage: false, keys: true, friends: false, meets: false, nudge: false, push: false, satellite: false }   // twisty on by default (panel D-2), the weekly reminder off until asked for (R-1); stage and night are derived from the two modes; analysis.html reads toggles.night
    };
    const NOTES_MODES = ['auto', 'full', 'quiet'], NIGHT_MODES = ['auto', 'on', 'off'], MUSIC_MODES = ['lower', 'pause'];
    const MODE_LABEL = { auto: 'Auto', full: 'Full', quiet: 'Quiet', on: 'On', off: 'Off' };
    const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function nightPosition() {
      if (state.mode === 'live' && state.live && Number.isFinite(state.live.lat) && Number.isFinite(state.live.lon)) return state.live;
      if (track) {
        const p = sample(track, state.cursorM);
        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return p;
      }
      return state.lastPosition;
    }
    function isNight() {
      if (state.nightMode !== 'auto') return state.nightMode === 'on';
      const p = nightPosition();
      return p ? ApexSun.isDark(new Date(), p.lat, p.lon) : !!(darkQuery && darkQuery.matches);
    }
    function syncDerivedToggles() { state.toggles.stage = state.notesMode === 'full'; state.toggles.night = isNight(); }
    // Off route in live mode: web/reroute.js decides, reroute() (ROUTING) rebuilds the plan.
    const rerouter = new ApexReroute.RerouteMonitor();
    // Traffic on the route ahead (iOS app only, Apple via the shell): web/traffic.js decides, checkTraffic() (ROUTING) asks.
    const trafficMon = new ApexTraffic.TrafficMonitor();
    const routeWatch = { note: null, frame: null, bestM: 0, offAt: null, saidAt: null };   // offAt/saidAt: the off-route episode, "Back on route" (U-90)
    const BACK_ON_QUIET_MS = 60000;
    const etaPace = ApexEta.createEta();   // live ETA on the current route: pace per section class, a slow arrival (paintEta, U-108)
    const etaSections = new WeakMap();      // track -> its corner sections (ApexEta.cornerSections), worked out once
    let etaText = '', etaLeftS = null;
    let replayEnded = false, replayWaiting = false;   // U-110 a finished replay, U-128 a replay waiting for its map (paintReplayEnd)
    const car = { serial: 0, route: '', guideAt: 0, guideKey: '', sightKey: '', look: '', hazards: '', symbols: new Map(), ended: null, along: '', offerSerial: 0, offer: null, echo: 0, attacks: [], road: '', roadAt: -1e9, limitKey: '' };   // what the car's screen was last sent (carRoute, carGuide below)   // strip text while off route; last frame fed; furthest progress
    try {
      const saved = JSON.parse(localStorage.getItem('apex.prefs') || 'null');
      if (saved) {
        Object.assign(state.toggles, saved.toggles || {});
        if (saved.twistyV !== 2) state.toggles.twisty = true;   // panel D-2: every save before it had the old default (off) written in
        state.toggles.dna = false;   // the Road scores switch is gone (BRAND §7 item 5); a stored "on" must not leave the layer stuck on
        // Old saves only have toggles.stage / toggles.night: stage true = Full, false = Auto; night true = On, false = Off (a saved false was a choice, not unset).
        state.noteWords = saved.noteWords === 'plain' || saved.noteWords === 'rally' ? saved.noteWords : 'rally';   // people from before V-02 keep rally
        state.musicMode = MUSIC_MODES.includes(saved.musicMode) ? saved.musicMode : 'lower';
        state.notesMode = NOTES_MODES.includes(saved.notesMode) ? saved.notesMode : (saved.toggles && saved.toggles.stage ? 'full' : 'auto');
        state.nightMode = NIGHT_MODES.includes(saved.nightMode) ? saved.nightMode : (saved.toggles && saved.toggles.night ? 'on' : saved.toggles && 'night' in saved.toggles ? 'off' : 'auto');
      }
      if (saved) { if (saved.theme && saved.themeV === 2) state.theme = saved.theme; if (saved.camFeel) state.camFeel = saved.camFeel; if (saved.voiceId) state.voiceId = saved.voiceId; if (typeof saved.voicePick === 'string' && /^[a-z]{1,20}$/.test(saved.voicePick)) state.voicePick = saved.voicePick; if (saved.liveVoice != null && saved.liveVoiceV >= 2) state.liveVoice = saved.liveVoice; /* saves from before v2 defaulted to ON and started a 90 MB download unasked */ if (saved.voiceName != null) state.voiceName = saved.voiceName; if (saved.hlOn != null) state.hlOn = !!saved.hlOn; if (saved.hlStrength > 0) state.hlStrength = saved.hlStrength; }
    } catch (_) {}
    if (params.has('night')) state.nightMode = params.get('night') === '1' ? 'on' : params.get('night') === 'auto' ? 'auto' : 'off';
    if (params.has('notes') && NOTES_MODES.includes(params.get('notes'))) state.notesMode = params.get('notes');
    syncDerivedToggles();
    if (params.has('theme')) state.theme = params.get('theme');
    if (params.has('cam')) state.camFeel = params.get('cam');
    if (params.has('voice')) state.voiceId = params.get('voice');
    state.voiceStyle = 'codriver';

    let bankVoices = [];                                             // the voice banks on the phone (web/voices/index.json)
    let look = Themes.apply(state.theme, state.toggles.night);
    ApexFormat.applyTypeScale(document);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) ApexFormat.applyTypeScale(document); });   // text size changed in Settings
    state.theme = look.theme.id;   // a retired or unknown saved theme resolves to the one it maps to
    let cluster = Inst.mountCluster($('cluster'), look.theme);
    // App health counts (IDEAS Y-03; web/health.js): yesterday's totals, anonymous, once a day; Settings → Your data switches it off.
    const health = window.ApexHealth ? ApexHealth.createHealth(localStorage,
      async (b) => window.APEX_REVIEW ? 204 : (await fetch(`${window.ApexSync ? ApexSync.apiBase : ''}/api/app-health`, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json', 'x-apexnav': '1' }, body: JSON.stringify(b) })).status,
      () => !!state.toggles.health) : { bump() {}, flush: async () => 0 };
    function savePrefs() { try { localStorage.setItem('apex.prefs', JSON.stringify({ theme: state.theme, themeV: 2, camFeel: state.camFeel, voiceId: state.voiceId, voicePick: state.voicePick, liveVoice: state.liveVoice, liveVoiceV: 2, voiceName: state.voiceName, hlOn: state.hlOn, hlStrength: state.hlStrength, notesMode: state.notesMode, noteWords: state.noteWords, musicMode: state.musicMode, nightMode: state.nightMode, toggles: state.toggles, twistyV: 2 })); } catch (_) {} }
    function paintSwitches() {
      try { carLook(); } catch (_) {}                                     // the car's screen follows the theme and the voice switch
      document.querySelectorAll('[data-toggle]').forEach(b => { const on = !!state.toggles[b.dataset.toggle]; b.classList.toggle('on', on); b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(on)); });
      document.querySelectorAll('#nightSwitch [data-night]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.night === state.nightMode)));
      document.querySelectorAll('[data-notes]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.notes === state.notesMode)));   // U-82
      document.querySelectorAll('[data-music]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.music === state.musicMode)));
      // the co-driver's voice is its own choice (any pack with any theme, private ones too); Suggested follows the look
      document.querySelectorAll('[data-pack]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.pack === (state.voicePick || 'look'))));
      const pn = document.getElementById('packNote'), sug = look && look.theme && look.theme.voice;
      // TestFlight 2026-11-12 (less text): a line only for Suggested, to say whose voice that is
      if (pn) { pn.textContent = !state.voicePick && sug ? `${sug.name}, the voice ${look.theme.label} suggests.` : ''; pn.hidden = !pn.textContent; }
      // SO-1: the Garage says what the one Notes and Voice switches (in Layers) are set to, in their own words
      const now = document.getElementById('coNotesNow');
      if (now) now.textContent = `Notes: ${({ quiet: 'Quiet', auto: 'Auto', full: 'Full' })[state.notesMode] || '--'} · Voice ${state.toggles.voice ? 'on' : 'off'}`;
    }
    // F-09 (REVIEW_FEEL): the look changes in one frame (the page's colours, the dials, the map's palette, only the paint
    // values that changed: basemap.js); what nobody sees in that frame (the route line's sector colours, the hidden Log)
    // follows when the page is idle, for the newest theme only.
    let themeAfter = 0;
    function applyTheme() {
      syncDerivedToggles();
      look = Themes.apply(state.theme, state.toggles.night);
      if (typeof themeVoice === 'function') themeVoice();               // the theme's suggested co-driver, unless the driver chose one
      cluster = Inst.mountCluster($('cluster'), look.theme);
      paintSwitches();
      restyleBasemap();
      savePrefs();
      render(false);
      const n = ++themeAfter;
      idle(() => {
        if (n !== themeAfter) return;
        if (track && track.kind !== 'horizon') loadTrackOnMap();   // the road ahead is never drawn
        if (window.ApexLogHost) ApexLogHost.changed('theme');
      });
    }
    function refreshAutoNight() {
      if (state.nightMode === 'auto' && isNight() !== state.toggles.night) applyTheme();
    }

    // =======================================================================
    // 3. SAMPLING
    // =======================================================================
    function indexAt(t, m) {
      let i = Math.max(0, Math.min(t.dist.length - 2, Math.floor(m / 5)));
      while (i < t.dist.length - 2 && t.dist[i + 1] <= m) i++;
      while (i > 0 && t.dist[i] > m) i--;
      return i;
    }
    function lerpAt(arr, i, f) {
      if (!arr || arr[i] == null) return null;
      const b = arr[Math.min(arr.length - 1, i + 1)];
      return b == null ? arr[i] : arr[i] + (b - arr[i]) * f;
    }
    function sample(t, m) {
      const total = t.dist[t.dist.length - 1];
      m = Math.max(0, Math.min(total, m));
      const i = indexAt(t, m);
      const f = Math.max(0, Math.min(1, (m - t.dist[i]) / Math.max(0.01, t.dist[i + 1] - t.dist[i])));
      const j = Math.min(t.lat.length - 1, i + 6);
      return {
        i, m, lat: lerpAt(t.lat, i, f), lon: lerpAt(t.lon, i, f), bearing: bearingDeg(t.lat[i], t.lon[i], t.lat[j], t.lon[j]),
        speedMps: lerpAt(t.speedMps, i, f), latG: lerpAt(t.latG, i, f), lonG: lerpAt(t.lonG, i, f), camberDeg: lerpAt(t.camberDeg, i, f)
      };
    }
    function bearingDeg(lat1, lon1, lat2, lon2) {
      const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
      return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * 180 / Math.PI + 360) % 360;
    }
    const angleDelta = (a, b) => ((b - a + 540) % 360) - 180;
    const totalM = () => (track ? track.dist[track.dist.length - 1] : 0);

    // =======================================================================
    // 4. MAP — theme-driven restyle of OpenFreeMap + DEM hillshade/contours
    // =======================================================================
    // Start where the phone last was (saved below), not at a fixed demo road; the first fix moves the map anyway.
    const LAST_POS = 'apex.lastPos';
    const startPos = (() => { try { const p = JSON.parse(localStorage.getItem(LAST_POS) || 'null'); return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null; } catch (_) { return null; } })();
    const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
    // Offline areas (offline_tiles.js, IDEAS F-02): map requests go through a protocol that serves a saved copy first
    try { if (window.ApexOfflineTiles) ApexOfflineTiles.install(maplibregl); } catch (_) {}
    // the car's map keeps its own copy of the saved areas (CarPlay/ApexCarOffline.swift): the list as it is now, at launch,
    // so areas saved before this build (or while the car's map couldn't keep them) are caught up
    try { if (window.ApexOfflineTiles && ApexOfflineTiles.tellShell) ApexOfflineTiles.tellShell(); } catch (_) {}
    const map = new maplibregl.Map({ container: 'map', style: MAP_STYLE,
      center: startPos ? [startPos.lon, startPos.lat] : [-84.70, 39.24], zoom: 14.6, pitch: 45, maxPitch: 60, attributionControl: { compact: true }, fadeDuration: 0,
      trackResize: false,   // F-02: the page's own observer resizes it (below), once, not again after setPixelRatio already did
      transformRequest: window.ApexOfflineTiles ? ApexOfflineTiles.transform : undefined });
    // No silent blank (as the drive page's map, drive_basemap.js): when no base map tile can be drawn here (no signal and no
    // saved area, or the map's server failing), one line says so and what still works. A tile that draws takes it away.
    const mapNote = { el: document.getElementById('mapNote'), okAt: 0, failAt: 0, timer: 0 };
    const paintMapNote = () => {
      const n = mapNote.el; if (!n) return;
      const show = mapNote.failAt > mapNote.okAt;
      n.hidden = !show;
      if (show) n.textContent = navigator.onLine === false ? 'No map here without signal. Notes and recording still work.' : 'The map couldn’t load. Notes and recording still work.';
    };
    const mapNoteSoon = () => { clearTimeout(mapNote.timer); mapNote.timer = setTimeout(paintMapNote, 1500); };   // a passing failure never flashes it
    map.on('data', (e) => { if (e.dataType === 'source' && e.sourceId === 'openmaptiles' && e.tile) { mapNote.okAt = Date.now(); paintMapNote(); } });
    map.on('error', (e) => { if (e && (e.sourceId === 'openmaptiles' || (!e.sourceId && !mapReady))) {   // a base map tile, or the style before the map first loaded
      mapNote.failAt = Date.now(); mapNoteSoon(); } });
    window.addEventListener('online', () => { mapNote.failAt = 0; paintMapNote(); });
    // A first launch with no signal: the base map's style has never been kept on this phone (offline_tiles.js keeps it as it
    // arrives), so the map would never load and nothing of ours could draw on the paper: no trail behind the arrow, no route,
    // no corners. An empty style (our own layers only, on the paper) lets the map load; the base map comes with the next
    // launch that has signal, or as soon as signal is back while no drive is on (a reload, which keeps the planned route).
    let paperOnly = false;
    const PAPER_STYLE = { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [] };
    map.on('error', (e) => {
      let st = null; try { st = map.getStyle(); } catch (_) { st = null; }
      if (mapReady || paperOnly || (e && e.sourceId) || st) return;   // only the style itself failing, before the map first loaded
      paperOnly = true;
      map.setStyle(PAPER_STYLE);
    });
    window.addEventListener('online', async () => {
      if (!paperOnly || state.mode === 'live' || driveActive) return;
      const r = await fetch(MAP_STYLE, { cache: 'no-store' }).catch(() => null);   // signal that can fetch the style, not just a flicker
      if (r && r.ok && state.mode !== 'live' && !driveActive) location.reload();
    });
    { const v = document.getElementById('aboutVersion'), m = /ApexNav\/([^ ]+ \([^)]*\))/.exec(navigator.userAgent);   // the iOS shell names its version in the user agent
      if (v) v.textContent = m ? m[1] : (window.APEX_EMBED ? '--' : 'Website'); }
    window.apexDebug = { map, get soundtrack() { return { playing: !!(soundtrack.eng && soundtrack.eng.playing()), frame: soundtrack.frame, piece: soundtrack.eng && soundtrack.eng.piece(), sample: !!soundtrack.demo }; }, get track() { return track; }, state, drives, buildRoute: (...a) => buildRoute(...a), renderRouteCard: (...a) => renderRouteCard(...a), openRoadPage: (...a) => openRoadPage(...a), showEndCard: (...a) => showEndCard(...a), get driveActive() { return driveActive; }, get flowRun() { return drive.flow ? drive.flow.run : null; }, get wetRoad() { return drive.wet ? drive.wet.state : null; }, get passRefs() { return passRefs.length; }, refreshSavedDrives: () => refreshSavedDrives(), get camResets() { return camResets; }, tryTheme: (id) => tryTheme(id), tulipPNG: (svg) => tulipPNG(svg), carLanes: (p) => carLanes(p), horizonFrom: async (coords) => { const t = await trackFromPolyline(coords, 'horizon', 'The road ahead'); t.kind = 'horizon'; useHorizon(t); return t.id; } };
    let mapReady = false;
    // F-02: the map's box is fixed (the window, or a drive's edges); it changes on a rotation or at a drive's start and end.
    // A resize the map already made (setPixelRatio resizes) is not made twice.
    const mapBox = { w: map.getContainer().clientWidth, h: map.getContainer().clientHeight };
    map.on('resize', () => { const c = map.getContainer(); mapBox.w = c.clientWidth; mapBox.h = c.clientHeight; });
    if (window.ResizeObserver) new ResizeObserver(() => { const c = map.getContainer(); if (c.clientWidth !== mapBox.w || c.clientHeight !== mapBox.h) map.resize(); }).observe(document.getElementById('map'));
    // F-02: what the chrome leaves of the map (the stage's cell), as insets from the map's edges. The camera's padding and
    // the fits use it; it is read when the stage's cell changes, never per frame, and changing it never touches the canvas.
    // While a sheet is open (People, Garage, Where to?) the camera keeps the view it had: the chrome a sheet moves is not a
    // reason to move a map it covers, and moving it would draw frames under the sheet's slide. A fit reads viewInsets() fresh.
    const stageView = { t: 0, r: 0, b: 0, l: 0 };
    function viewInsets() {
      const s = document.querySelector('#app > .stage').getBoundingClientRect(), m = map.getContainer().getBoundingClientRect();
      return { t: Math.max(0, Math.round(s.top - m.top)), b: Math.max(0, Math.round(m.bottom - s.bottom)),
        l: Math.max(0, Math.round(s.left - m.left)), r: Math.max(0, Math.round(m.right - s.right)) };
    }
    function measureStage() {
      const app = document.getElementById('app');
      if (app && (app.classList.contains('sheet-open') || app.classList.contains('plan-open'))) return;
      Object.assign(stageView, viewInsets());
      const st = map.getContainer().style;
      st.setProperty('--vis-b', `${stageView.b}px`); st.setProperty('--vis-r', `${stageView.r}px`);
    }
    if (window.ResizeObserver) new ResizeObserver(measureStage).observe(document.querySelector('#app > .stage'));
    map.on('resize', measureStage);
    measureStage();
    // U-83: on its side the status line sits beside the notes strip; the strip's height (one line or three) is its height too
    if (window.ResizeObserver) new ResizeObserver(([e]) => document.getElementById('app').style.setProperty('--notes-h', `${Math.round(e.target.offsetHeight)}px`)).observe(document.getElementById('notes'));
    // iOS can drop the map's WebGL context under memory pressure (e.g. after building a long route): the page keeps running but
    // the map goes black. MapLibre recovers if WebKit restores the context; if it doesn't within 4 s, reload the page and plan the
    // same route again. Never during a drive: the recording lives in this page.
    let glTimer = null;
    map.on('webglcontextlost', () => {
      clearTimeout(glTimer);
      toast('Map graphics reset. Restoring…');
      glTimer = setTimeout(() => {
        if (state.mode === 'live') { toast('Map display lost. Your drive is still recording.'); return; }
        location.reload();                                                   // the planned route is kept (restorePlanned)
      }, 4000);
    });
    map.on('webglcontextrestored', () => { clearTimeout(glTimer); map.triggerRepaint(); });
    setInterval(() => { try { if (state.lastPosition) localStorage.setItem(LAST_POS, JSON.stringify(state.lastPosition)); } catch (_) {} }, 30000);
    // On the web the idle map follows the browser's GPS (the app's shell pushes its own frames instead). The browser asks once
    // and remembers the answer for the site; denied or unavailable leaves the map where it is.
    map.once('load', () => {
      if (IN_APP_SHELL || !navigator.geolocation) return;
      navigator.geolocation.watchPosition((p) => {
        const c = p.coords;
        state.lastPosition = { lat: c.latitude, lon: c.longitude }; state.lastPositionAt = performance.now();
        state.lastMotion = { heading: Number.isFinite(c.heading) ? c.heading : null, speedMps: Number.isFinite(c.speed) ? c.speed : null };
        feedMotion(c.speed);
        if (state.mode === 'live') return;   // a web drive feeds its own frames
        showIdleFix({ lat: c.latitude, lon: c.longitude, course_deg: Number.isFinite(c.heading) ? c.heading : NaN, speed_mps: Number.isFinite(c.speed) ? c.speed : 0 });
      }, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    });
    const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
    let demSource = null;
    try { demSource = new mlcontour.DemSource({ url: DEM_URL, encoding: 'terrarium', maxzoom: 13, worker: true }); demSource.setupMaplibre(maplibregl); } catch (_) { demSource = null; }

    const puckEl = document.createElement('div');
    puckEl.className = 'puck';
    puckEl.setAttribute('role', 'img');
    const puck = new maplibregl.Marker({ element: puckEl, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([-84.70, 39.24]).addTo(map);
    puckEl.setAttribute('aria-label', 'Your position');                  // after the Marker, which labels it "Map marker"
    // The sight-line speed under the arrow (the owner, 2026-10-29; web/carplay.js sightMessage): upright while the arrow
    // turns, red when you are faster than it, hidden when unknown. The car's map gets the same tag while you drive.
    const sightEl = document.createElement('div');
    sightEl.className = 'sight-tag'; sightEl.hidden = true; sightEl.setAttribute('role', 'img');
    const sightTag = new maplibregl.Marker({ element: sightEl, anchor: 'top', offset: [0, 15] }).setLngLat([-84.70, 39.24]).addTo(map);
    const SIGHT_EYE = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/></svg>';
    const SIGHT_EYE_BARRED = SIGHT_EYE.replace('</svg>', '<path d="M4 21 L20 3" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>');
    let sightKey = '';
    const sightHold = ApexCarPlay.sightFilter();                         // U-60: render() steps it once a frame
    function paintSight(m, live) {
      const key = JSON.stringify(m);
      if (key !== sightKey) {
        sightKey = key;
        // panel round 2 (TH-2, IN-3): the tag names itself, "SIGHT 45" by the eye, with no unit, on a pill, so it never reads
        // as a limit sign; over it, "SLOW 45" with the eye barred on the signal colour; Open draws nothing (the cell says Open)
        const tag = ApexCarPlay.sightTag(m);
        sightEl.hidden = !tag;
        if (tag) {
          sightEl.classList.toggle('short', tag.short);
          sightEl.innerHTML = tag.short ? SIGHT_EYE_BARRED : SIGHT_EYE;
          sightEl.append(el('small', { textContent: tag.label }), el('b', { textContent: tag.text }));
          sightEl.setAttribute('aria-label', `Sight-line speed ${tag.text} ${String(m.unit || '').toLowerCase()}${tag.short ? ', faster than you can see' : ''}`);
        }
      }
      if (live && key !== car.sightKey) { car.sightKey = key; carPost(m); }
    }
    // the posted limit on the car's map (web/carplay.js limitMessage), sent when it changes; never while the drive isn't live
    function carLimit(limit, unit) {
      const m = ApexCarPlay.limitMessage(limit, unit), key = JSON.stringify(m);
      if (key !== car.limitKey) { car.limitKey = key; carPost(m); }
    }
    function drawPuck() {
      const c = look.colors, carSvg = Themes.carSVG(look.theme, look.map.casing, 34, 34);   // outlined as the map draws its roads
      // a car's own theme: the arrow is that car from above, in its paint, outlined in the panel's ink (theme_contract.js holds
      // the outline to 3:1 on the map); every other theme keeps the ink arrow (panel round 2: a position, in ink)
      puckEl.classList.toggle('car-puck', !!carSvg);
      puckEl.innerHTML = carSvg || `<svg viewBox="0 0 26 26" width="26" height="26"><circle cx="13" cy="13" r="11" fill="${c.panel}" stroke="${c.panelInk}" stroke-width="2"/><path d="M13 5 L19 18 L13 14.8 L7 18 Z" fill="${c.panelInk}"/></svg>`;   // panel round 2: a position, in ink
      sightTag.setOffset([0, carSvg ? 19 : 15]);                         // the tag stays clear of the car's tail
    }

    function restyleBasemap() {
      drawPuck();
      $('map').style.background = look.map.bg;                             // U-68: the paper the map fades in on
      if (!mapReady) return;
      const P = look.map, C = look.colors;
      ApexBasemap.restyle(map, P);                                         // web/basemap.js: shared with the car's screen
      const has = (id) => map.getLayer(id);
      if (has('apex-route-casing')) map.setPaintProperty('apex-route-casing', 'line-color', C.routeCasing);
      if (has('apex-route')) map.setPaintProperty('apex-route', 'line-color', C.route);
      if (has('apex-alt')) map.setPaintProperty('apex-alt', 'line-color', C.route);
      if (has('apex-explore')) map.setPaintProperty('apex-explore', 'line-color', C.route);
      if (has('apex-twisty')) map.setPaintProperty('apex-twisty', 'line-color', C.amber);
      if (has('apex-places')) { map.setPaintProperty('apex-places', 'text-color', P.label); map.setPaintProperty('apex-places', 'text-halo-color', P.halo); placeGlyphs(P.label, P.halo); }
      // Measured roads by the pavement measured there (coverage.js surface): smooth, fair, rough; ink where roughness is unknown
      if (has('apex-coverage')) map.setPaintProperty('apex-coverage', 'line-color', ['match', ['get', 's'], 1, C.gain, 2, C.amber, 3, C.signal, C.dim]);
    }

    function addApexLayers() {
      const firstSymbol = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
      map.addSource('apex-dem', { type: 'raster-dem', tiles: [demSource ? demSource.sharedDemProtocolUrl : DEM_URL], tileSize: 256, encoding: 'terrarium', maxzoom: 13 });
      map.addLayer({ id: 'apex-hillshade', type: 'hillshade', source: 'apex-dem', paint: {} }, firstSymbol);
      if (demSource) {
        map.addSource('apex-contour-src', { type: 'vector', maxzoom: 15, tiles: [demSource.contourProtocolUrl({
          multiplier: 3.28084, thresholds: { 11: [200, 1000], 12: [100, 500], 13: [50, 250], 14: [20, 100], 15: [10, 50] },
          elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours' })] });
        map.addLayer({ id: 'apex-contours', type: 'line', source: 'apex-contour-src', 'source-layer': 'contours',
          paint: { 'line-width': ['match', ['get', 'level'], 1, 0.9, 0.45], 'line-opacity': ['match', ['get', 'level'], 1, 0.55, 0.32] } }, firstSymbol);
        map.addLayer({ id: 'apex-contour-labels', type: 'symbol', source: 'apex-contour-src', 'source-layer': 'contours', filter: ['>', ['get', 'level'], 0],
          layout: { 'symbol-placement': 'line', 'text-size': 9, 'text-field': ['concat', ['number-format', ['get', 'ele'], {}], "'"], 'text-font': ['Noto Sans Regular'] },
          paint: { 'text-halo-width': 1.2 } });
      }
      map.addSource('apex-route-src', { type: 'geojson', data: emptyFC(), lineMetrics: true });   // lineMetrics: the reveal draws the line by its progress (penDraw)
      const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 16, b];
      // Twisty roads (map shape, not measured): under every route line. t = 2 very twisty, 1 twisty.
      map.addSource('apex-twisty-src', { type: 'geojson', data: emptyFC() });
      const byTier = (strong, weak) => ['match', ['get', 't'], 2, strong, weak];
      map.addLayer({ id: 'apex-twisty', type: 'line', source: 'apex-twisty-src', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, byTier(2.5, 1.5), 16, byTier(8, 5)], 'line-opacity': byTier(0.9, 0.55) } }, firstSymbol);   // under the road names
      // Measured roads (coverage.js, IDEAS Q-14): t = 2 five or more passes, 1 two to four, 0 one pass (faint).
      map.addSource('apex-coverage-src', { type: 'geojson', data: emptyFC() });
      map.addLayer({ id: 'apex-coverage', type: 'line', source: 'apex-coverage-src', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 't'], 2, 3, 1, 1.5, 1], 16, ['match', ['get', 't'], 2, 9, 1, 5, 3]], 'line-opacity': ['match', ['get', 't'], 2, 0.85, 1, 0.6, 0.35] } }, firstSymbol);
      map.addSource('apex-alt-src', { type: 'geojson', data: emptyFC() });
      map.addLayer({ id: 'apex-alt', type: 'line', source: 'apex-alt-src', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': width(3, 6), 'line-opacity': 0.45, 'line-dasharray': [1.5, 1.5] } });
      map.addSource('apex-explore-src', { type: 'geojson', data: emptyFC() });
      map.addLayer({ id: 'apex-explore', type: 'line', source: 'apex-explore-src', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': width(4, 8), 'line-opacity': 0.7 } });
      map.addLayer({ id: 'apex-route-casing', type: 'line', source: 'apex-route-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': width(6, 13) } });
      map.addLayer({ id: 'apex-route', type: 'line', source: 'apex-route-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': width(3, 7) } });
      map.addLayer({ id: 'apex-dna', type: 'line', source: 'apex-route-src', filter: ['has', 'dna'], layout: { 'line-cap': 'butt', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': ['get', 'dna'], 'line-width': width(3, 7) } });
      // Places on the map (2026-11-13, as Apple and Google Maps show them): the eateries, cafés, fuel and shops with a name,
      // in the map's own label ink set in italic (a place, not a street), only close in (street zoom) and never in a drive;
      // a tap is the place's card (showPin)
      // (2026-11-14, behind apex.mapPlaces) each with its kind's glyph before its name, as Apple Maps marks a café or fuel
      if (map.getSource('openmaptiles')) placeGlyphs((look.map || {}).label || '#555', (look.map || {}).halo || '#fff');
      if (map.getSource('openmaptiles')) map.addLayer({ id: 'apex-places', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 15,
        filter: ['all', ['has', 'name'], ['match', ['get', 'class'], PLACE_CLASSES, true, false]],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-max-width': 8, 'text-padding': 10,
          'icon-image': ['match', ['get', 'class'], ...Object.entries(PLACE_GLYPH_OF).flat(), 'pl-sight'], 'icon-anchor': 'right', 'icon-offset': [-2, 0],
          'text-anchor': 'left', 'text-justify': 'left', 'text-offset': [0.15, 0], 'icon-optional': true,
          'symbol-sort-key': ['get', 'rank'], visibility: placesShown() ? 'visible' : 'none' },
        paint: { 'text-halo-width': 1.4 } }, firstSymbol);                // under the street and town names: they win a clash
      map.addSource('apex-ribbon-src', { type: 'geojson', data: emptyFC() }); ribbonKey = null;
      map.addLayer({ id: 'apex-ribbon', type: 'line', source: 'apex-ribbon-src', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'c'], 'line-width': width(4, 9) } });
    }
    const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
    // the kinds of place drawn (OpenMapTiles poi classes): what a driver stops for
    const PLACE_CLASSES = ['restaurant', 'fast_food', 'cafe', 'bar', 'beer', 'ice_cream', 'bakery', 'fuel', 'grocery', 'lodging', 'car', 'attraction', 'museum'];
    const PLACE_WORD = { restaurant: 'Restaurant', fast_food: 'Fast food', cafe: 'Café', bar: 'Bar', beer: 'Bar', ice_cream: 'Ice cream', bakery: 'Bakery',
      fuel: 'Fuel station', grocery: 'Grocery', lodging: 'Lodging', car: 'Car shop', attraction: 'Attraction', museum: 'Museum' };
    // ON: the owner said yes (his decision card of 2026-11-13, answered 2026-11-14). apex.mapPlaces = '0' still turns it off
    const placesFlag = () => { try { return localStorage.getItem('apex.mapPlaces') !== '0'; } catch (_) { return true; } };
    const placesShown = () => placesFlag() && state.mode !== 'live';
    // the kinds' glyphs (24 px grid, 1.75 px strokes, BRAND.md Icons), drawn in the look's label ink on a halo square, 2x
    const PLACE_GLYPH = { food: 'M7 3v7M5 3v5a2 2 0 0 0 4 0V3M7 10v11M17 21V3c-2 1.5-3 4.5-3 9h3',
      cafe: 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 11h1.5a2.5 2.5 0 0 1 0 5H16M9 3.5v2.5M12.5 3.5v2.5',
      fuel: 'M5 21V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V21M3.5 21h12M7.5 9h4M14 10h1.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 0 3 0V8.5L17.5 6',
      bar: 'M5 4h14l-7 8zM12 12v8M8 20h8', shop: 'M4 9h16l-2 10H6zM9 9l3-5 3 5', bed: 'M3 19V6M3 14h18v5M21 14v-2a3 3 0 0 0-3-3h-7v5M7 10.5h.01',
      car: 'M5 16l2-6h10l2 6v3H5zM5 16h14M8 19v2M16 19v2', sight: 'M6 21V4M6 4h11l-2 4 2 4H6' };
    const PLACE_GLYPH_OF = { restaurant: 'pl-food', fast_food: 'pl-food', cafe: 'pl-cafe', bakery: 'pl-cafe', ice_cream: 'pl-cafe', fuel: 'pl-fuel',
      bar: 'pl-bar', beer: 'pl-bar', grocery: 'pl-shop', lodging: 'pl-bed', car: 'pl-car' };
    function placeGlyphs(ink, halo) {
      if (!map || typeof Path2D === 'undefined') return;
      for (const [k, d] of Object.entries(PLACE_GLYPH)) {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 40; const g = c.getContext('2d');   // 20 pt, its glyph 16 pt
          g.fillStyle = halo; g.globalAlpha = 0.85; g.fillRect(0, 0, 40, 40); g.globalAlpha = 1;
          g.strokeStyle = ink; g.lineCap = g.lineJoin = 'round'; g.translate(4, 4); g.scale(4 / 3, 4 / 3); g.lineWidth = 1.75; g.stroke(new Path2D(d));
          const img = g.getImageData(0, 0, 40, 40), id = 'pl-' + k;
          if (map.hasImage(id)) map.updateImage(id, img); else map.addImage(id, img, { pixelRatio: 2 });
        } catch (_) { /* no canvas: the names alone */ }
      }
    }
    function applyPlaces() { if (mapReady && map.getLayer('apex-places')) map.setLayoutProperty('apex-places', 'visibility', placesShown() ? 'visible' : 'none'); }
    // Satellite, for developers only (the owner, 2026-11-04: to troubleshoot picks like a neighbourhood ranked a best road):
    // USGS The National Map's orthoimagery (USDA NAIP and USGS, public domain; the US only; tiles to zoom 16, stretched past
    // it) over the base map's fills and road lines, under our twisty and measured roads, the labels and every route line,
    // so what a road physically is shows under what we say about it. Drawn only while the server's /api/me says this account
    // is a developer (backend/src/developers.ts: the owner and the co-developer); a switch left on in localStorage, or by
    // another account on this phone, draws nothing and asks for no tile.
    const SAT_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
    let devAccess = false;
    function applySatellite() {
      if (!mapReady) return;
      const on = devAccess && !!state.toggles.satellite;
      if (on && !map.getLayer('apex-satellite')) {
        if (!map.getSource('apex-satellite-src')) map.addSource('apex-satellite-src', { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 16,
          attribution: 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a> (USDA NAIP), public domain' });
        map.addLayer({ id: 'apex-satellite', type: 'raster', source: 'apex-satellite-src', paint: { 'raster-fade-duration': 150 } }, map.getLayer('apex-twisty') ? 'apex-twisty' : undefined);
      } else if (!on && map.getLayer('apex-satellite')) { map.removeLayer('apex-satellite'); map.removeSource('apex-satellite-src'); }
    }
    // /api/me's word on developer tools: only a fresh answer counts (none at start, offline keeps none)
    function applyDevFlags(me) {
      if (!me || typeof me.signed_in !== 'boolean') return;
      devAccess = !!(me.signed_in && me.member && me.developer === true);
      $('satSwitch').hidden = !devAccess;
      if (!devAccess && state.toggles.satellite) { state.toggles.satellite = false; savePrefs(); paintSwitches(); }
      applySatellite();
      devCache = undefined;                                              // read again for this account (or none)
      applyDevTune();
      paintDevRow();
      if (devAccess) { const d = devSettings(); if (d && (d.offline || d.lines)) devPanel().catch(() => {}); }   // their switches, without the panel open
      else if (window.ApexDevPanel) ApexDevPanel.unmount();
    }
    // Dev mode (the owner, 2026-11-09: "a dev mode in the app that shows all routing parameters and other debug info for only
    // me and my codev to mess with"), behind the Satellite layer's gate: a fresh /api/me with developer true. Its settings
    // (localStorage apex.dev: the routing overrides and four switches, on this phone only) are read only then: for anyone
    // else, and before /api/me has answered, devSettings() is null and no plan changes. Its panel (web/dev_panel.js, lazy)
    // loads only for a developer. docs/CALL_SHEET.md 2026-11-09 (dev-mode).
    const DEV_KEY = 'apex.dev';
    let devCache, devPanelP = null;
    function devSettings() {
      if (!devAccess) return null;
      if (devCache === undefined) { try { devCache = JSON.parse(localStorage.getItem(DEV_KEY) || 'null'); } catch (_) { devCache = null; } }
      return devCache && typeof devCache === 'object' ? devCache : null;
    }
    const devOnlyTune = () => { const d = devSettings(); return d && FunRoute.tuned && FunRoute.tuned(d.tune) ? d.tune : null; };
    // Route tuning (web/route_tuning.js, the owner 2026-11-09): the driver's sliders, a tune of the same shape; Pro (pro.js
    // 'route_tuning': open to everyone until Pro goes on sale). Untouched sliders are no tune. A plan's tune is theirs with a
    // developer's Dev panel numbers on top; the planner reads it as before (dev.tune / dev.tuneReq, applyDevTune).
    const tuningFlags = () => (window.ApexFlags ? { pro: ApexFlags.on('pro', false), proOnSale: ApexFlags.on('proOnSale', false) } : {});
    const userTune = () => { try { return window.ApexRouteTuning ? ApexRouteTuning.active(localStorage, tuningFlags()) : null; } catch (_) { return null; } };
    /** The sliders a plan made now is tuned by (the route card's "Your tuning"), or null. */
    const userTuned = () => { try { return userTune() ? ApexRouteTuning.labels(ApexRouteTuning.load(localStorage)) : null; } catch (_) { return null; } };
    const devTune = () => (window.ApexRouteTuning ? ApexRouteTuning.merge(userTune(), devOnlyTune()) : devOnlyTune());
    function devTuneReq() { const t = devTune(); return t ? { tune: t } : {}; }
    function applyDevTune() { try { if (window.ApexRouteEngine && ApexRouteEngine.setTune) ApexRouteEngine.setTune(devTune()); } catch (e) { console.error('dev tune', e); } }
    const devOn = (k) => { const d = devSettings(); return !!(d && d[k]); };
    function devPanel() {
      if (!devAccess || !window.ApexLazy) return Promise.resolve(null);
      return devPanelP || (devPanelP = ApexLazy.load('dev').then(() => (window.ApexDevPanel ? ApexDevPanel.mount(devHost) : null)).catch((e) => { devPanelP = null; throw e; }));
    }
    // the Garage's Settings row (index.html section data-setting="dev"): empty, so hidden, unless this is a developer
    function paintDevRow() {
      const b = $('garageDevBody');
      if (!b) return;
      b.textContent = '';
      if (devAccess) {
        const p = document.createElement('p'); p.className = 'note'; p.textContent = 'Routing parameters, live overrides and the last plan\'s dump. Only you and the co-developer see this; overrides stay on this phone.';
        const o = document.createElement('button'); o.type = 'button'; o.className = 'ink-btn'; o.id = 'devOpenBtn'; o.textContent = 'Open the Dev panel';
        o.addEventListener('click', () => { if (window.ApexGarageSettings && ApexGarageSettings.ui) ApexGarageSettings.ui.close(); showView('map');
          devPanel().then((p) => p && p.open()).catch((e) => { console.error('dev panel', e); toast('Couldn\'t load the Dev panel.'); }); });
        b.append(p, o);
      }
      try { if (window.ApexGarageSettings && ApexGarageSettings.ui) ApexGarageSettings.ui.refresh(); } catch (_) { /* drawn at the next open */ }
    }
    // Garage → Settings → Route tuning (index.html section data-setting="tuning"): the sliders, saved as they move; the
    // engine's global tune follows at once, a plan's router tune at its next plan (or Use on the route on screen)
    function paintTuning() {
      const b = $('garageTuneBody');
      if (!b || !window.ApexRouteTuning) return null;
      b.textContent = '';
      // Its row in the Settings list says what the sheet's own status line says: "Standard", or how many sliders were moved.
      // Nothing while the tuning isn't this phone's to use (the sliders are kept, the routes are the defaults).
      const summary = () => { try {
        if (!ApexRouteTuning.allowed(localStorage, tuningFlags())) { delete b.dataset.summaryText; return; }
        const n = ApexRouteTuning.changed(ApexRouteTuning.load(localStorage)).length; b.dataset.summaryText = n ? `${n} changed` : 'Standard';
      } catch (_) { delete b.dataset.summaryText; } };
      summary();
      const ui = ApexRouteTuning.mountScreen(b, {
        store: localStorage, flags: tuningFlags, changed: () => { applyDevTune(); summary(); },
        planned: () => !!(plannedRoute && plannedRoute.id === 'route_dest' && plannedRoute.request && state.mode !== 'live'),
        replan: () => replanForLevel('Your tuning'), proLine: () => (window.ApexPro ? ApexPro.line('route_tuning', tuningFlags()) : null),
      });
      // (repainted when its row opens: Pro's flags and the route on screen may have changed since)
      document.addEventListener('click', (e) => { const r = e.target && e.target.closest && e.target.closest('.nav-row[data-setting="tuning"]'); if (r) ui.paint(); }, true);
      return ui;
    }
    // what the panel reads and does (web/dev_panel.js mount(host)): nothing here runs unless it is open or its switches are on
    const devHost = {
      allowed: () => devAccess,
      settings: () => JSON.parse(JSON.stringify(devSettings() || {})),
      save(s) {
        if (!devAccess) return false;
        devCache = s && typeof s === 'object' ? s : null;
        try { if (devCache) localStorage.setItem(DEV_KEY, JSON.stringify(devCache)); else localStorage.removeItem(DEV_KEY); } catch (_) { /* this session only */ }
        applyDevTune();
        return true;
      },
      defaults: () => ({ router: window.ApexGraphRouter ? FunRoute.tuneKnobs(ApexGraphRouter.K) : {}, ...((window.ApexRouteEngine && ApexRouteEngine.tuneDefaults && ApexRouteEngine.tuneDefaults()) || {}) }),
      replan: () => replanForLevel('Dev re-plan'),
      plan: () => (window.apexDebug && apexDebug.devPlan) || null,
      planned: () => !!(plannedRoute && plannedRoute.id === 'route_dest' && plannedRoute.request),
      versions: async () => {
        const out = { router: window.ApexGraphRouter ? ApexGraphRouter.VERSION : null, engine: window.ApexRouteEngine ? ApexRouteEngine.VERSION : null,
          contextGrid: window.ApexContextGrid ? ApexContextGrid.VERSION : null, app: ($('aboutVersion') || {}).textContent || null };
        try { const ix = window.ApexGraphTiles && ApexGraphTiles.index ? await ApexGraphTiles.index() : null; out.graph = ix ? { format: ix.version, bundled: ix.bundled, region: ix.region, tiles: Object.keys(ix.tiles || {}).length } : null; } catch (_) { out.graph = null; }
        // the context grid's shipped index (the Worker's region index is the grid's own business: route_ctx/context_grid.js)
        try { const r = await fetch(((window.ApexContextGrid && ApexContextGrid.BASE) || 'data/ctx/v1/') + 'index.json'); const j = r.ok ? await r.json() : null;
          out.contextIndex = j ? { v: j.v, built: j.built, region: j.region, bundles: Object.keys(j.bundles || {}).length } : null; } catch (_) { out.contextIndex = null; }
        return out;
      },
      map, toast,
    };
    // the planner's side (funRoute, ownOn, ownRefine read it as window.apexDebug.dev, so the plan's code stands on its own):
    // every answer is "off" or nothing unless /api/me said developer
    window.apexDebug.dev = Object.freeze({ allowed: () => devAccess, on: devOn, settings: devSettings, tune: devTune, tuneReq: devTuneReq,
      planned: () => { if (devAccess && window.ApexDevPanel) ApexDevPanel.planned(); },
      // Route tuning's side, for everyone (route_tuning.js): lay the tune on the page's engine now; the sliders a plan uses
      apply: () => applyDevTune(), tuned: () => userTuned() });
    // (once the page's state below is set up: the screen asks whether a route is on screen)
    let tuningUi = null;
    try { applyDevTune(); } catch (e) { console.error('route tuning', e); }
    setTimeout(() => { try { tuningUi = paintTuning(); } catch (e) { console.error('route tuning', e); } }, 0);

    function mixHex(a, b, t) {
      const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
      const A = p(a), B = p(b);
      return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
    }
    function dnaComposite(s) {
      const v = [s.tech, s.flow, s.surf];
      if (s.clear != null) v.push(s.clear);
      return v.reduce((a, b) => a + b, 0) / v.length;
    }
    // Sector colour = the theme's route colour faded toward the stage by how worth driving it is.
    const dnaColor = (score) => mixHex(look.colors.stage, look.colors.route, [0.2, 0.45, 0.72, 1][score >= 70 ? 3 : score >= 58 ? 2 : score >= 46 ? 1 : 0]);

    function routeGeoJSON(t) {
      const coords = (a, b) => { const c = []; for (let i = a; i <= b; i++) c.push([t.lon[i], t.lat[i]]); return c; };
      if (!t.sectors) return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords(0, t.lat.length - 1) } }] };
      return { type: 'FeatureCollection', features: t.sectors.map(s => ({ type: 'Feature', properties: { dna: dnaColor(dnaComposite(s)) },
        geometry: { type: 'LineString', coordinates: coords(s.start_index, Math.min(t.lat.length - 1, s.end_index + 1)) } })) };
    }

    // Braking ribbon: next 300 m coloured by current speed vs the envelope there.
    // F-18 (REVIEW_FEEL): it is asked for every frame; the walk fills two reused sets of runs (route-point index ranges and a
    // colour) and compares them with the last ones sent, so nothing is allocated unless the ribbon changed; then the GeoJSON
    // is built once, a few times a second. A run overlaps the next by one segment, as the coloured line always has.
    const RIBBON_N = 61;
    const ribbonRuns = () => ({ s: new Int32Array(RIBBON_N), e: new Int32Array(RIBBON_N), c: new Array(RIBBON_N).fill(null), n: 0 });
    let ribbonA = ribbonRuns(), ribbonB = ribbonRuns(), ribbonFrom = -1, ribbonStop = -1;
    let lastRibbonAt = 0, ribbonKey = null, ribbonTrack = null;   // ribbonKey: '' when the ribbon is empty on the map, null to send again
    function updateRibbon(vMps, fromIdx, force) {
      if (!mapReady) return;
      const now = performance.now();
      if (!force && now - lastRibbonAt < 90) return;
      lastRibbonAt = now;
      const src = map.getSource('apex-ribbon-src');
      if (!track || !track.envMps || vMps == null || fromIdx < 0) { if (ribbonKey !== '' || force) src.setData(emptyFC()); ribbonKey = ''; return; }
      const C = look.colors, R = ribbonB;
      R.n = 0;
      let open = false;
      const stop = Math.min(track.lat.length - 1, fromIdx + 60);
      for (let i = fromIdx; i <= stop; i++) {
        const env = track.envMps[i];
        if (!Number.isFinite(env)) { open = false; continue; }
        const c = vMps > env + 0.5 ? C.signal : (vMps > env - 3 ? C.amber : C.calm);
        if (!open) { R.s[R.n] = i; R.e[R.n] = i; R.c[R.n] = c; R.n++; open = true; }
        else if (R.c[R.n - 1] !== c) { R.e[R.n - 1] = i; R.s[R.n] = i - 1; R.e[R.n] = i; R.c[R.n] = c; R.n++; }
        else R.e[R.n - 1] = i;
      }
      // Perf: the same ribbon is not sent again (each setData re-tiles the source in the map's worker); it changes when the
      // car reaches the next route point or a colour changes, a few times a second, not with every fix
      const A = ribbonA;
      let same = ribbonKey === 'on' && track === ribbonTrack && !force && fromIdx === ribbonFrom && stop === ribbonStop && A.n === R.n;
      for (let k = 0; same && k < R.n; k++) same = A.s[k] === R.s[k] && A.e[k] === R.e[k] && A.c[k] === R.c[k];
      if (same) return;
      ribbonA = R; ribbonB = A; ribbonKey = 'on'; ribbonTrack = track; ribbonFrom = fromIdx; ribbonStop = stop;
      const features = [];
      for (let k = 0; k < R.n; k++) {
        if (R.e[k] <= R.s[k]) continue;                                  // a single point draws nothing
        const coords = [];
        for (let i = R.s[k]; i <= R.e[k]; i++) coords.push([track.lon[i], track.lat[i]]);
        features.push({ type: 'Feature', properties: { c: R.c[k] }, geometry: { type: 'LineString', coordinates: coords } });
      }
      src.setData({ type: 'FeatureCollection', features });
    }

    let pins = [];
    const fuelPins = [];                                                    // U-85: the route's FUEL stamps, { m, el }
    function rebuildPins() {
      pins.forEach(p => p.marker.remove());
      pins = [];
      if (!track) return;
      for (const e of allEvents()) {
        if (e.type === 'corner') continue;
        const el = document.createElement('div');
        el.className = `pin ${e.type}`;
        el.textContent = e.code;
        el.addEventListener('click', (ev) => { ev.stopPropagation(); say(`${e.call}.`, true, [e]); });
        pins.push({ e, el, marker: new maplibregl.Marker({ element: el }).setLngLat([e.lon, e.lat]).addTo(map) });
      }
      updatePins();
    }
    function updatePins() {
      for (const p of pins) {
        const d = p.e.dist_m - state.cursorM;
        p.el.style.display = d > -150 && d < 2500 && (p.e.type !== 'alpr' || state.toggles.lpr) ? 'block' : 'none';
      }
      declutterSoon();                                                     // the notes' stamps keep the map's pins off them
      // U-85: in a drive only the next fuel stop ahead keeps its stamp (the preview shows them all)
      if (!fuelPins.length) return;                                        // (filled only once a route exists)
      const driving = state.mode === 'live', next = driving && track === plannedRoute ? fuelPins.find((f) => f.m > state.cursorM) : null;
      for (const f of fuelPins) {
        f.el.style.display = !driving || f === next ? '' : 'none';
        // the owner, 2026-11-11: the one fuel stamp of a drive says which station it is, when the map names it
        const label = f === next && f.name ? `FUEL · ${f.name}` : 'FUEL';
        if (f.el.textContent !== label) f.el.textContent = label;
      }
      declutterSoon();
    }
    // The owner, 2026-11-04: no pile of overlapping FUEL stamps along the route. The viewpoint, café and fuel pins
    // (attachScenic) that would overlap on screen hide, the most useful few kept (scenic.js declutter), again as the map
    // moves. Hidden by visibility, so a drive's "only the next fuel stop" (display) stays its own rule.
    const poiDeclutter = { raf: 0, pins: [] };
    const VIEW_NAME_ZOOM = 15;
    function declutterSoon() {
      if (!poiDeclutter.raf && (poiDeclutter.pins.length || pins.length)) poiDeclutter.raf = requestAnimationFrame(declutterPois);
    }
    function declutterPois() {
      poiDeclutter.raf = 0;
      if (!window.ApexScenic || !ApexScenic.declutter) return;
      // the route notes' stamps (LPR, SPD, a hazard) are `fixed`: always shown, the map's pins kept off them (scenic.js)
      const notePins = pins.map((p) => ({ marker: p.marker, el: p.el, kind: `note:${p.e.code}`, fixed: true, m: p.e.dist_m }));
      const shown = poiDeclutter.pins.concat(notePins).filter((p) => p.el.style.display !== 'none' && p.el.isConnected), c = map.getContainer();
      const close = map.getZoom() >= VIEW_NAME_ZOOM;                    // a named viewpoint's name, only where it has room
      for (const p of shown) if (p.kind === 'view' && p.name) { const t = close ? p.name : SCENIC_LABEL.view; if (p.el.textContent !== t) p.el.textContent = t; }
      const keep = ApexScenic.declutter(shown.map((p) => {
        const xy = map.project(p.marker.getLngLat());
        return { kind: p.kind, named: p.named, fixed: !!p.fixed, m: p.m, x: xy.x, y: xy.y, w: p.el.offsetWidth, h: p.el.offsetHeight };
      }), { w: c.clientWidth, h: c.clientHeight });
      shown.forEach((p, i) => { p.el.style.visibility = keep[i] ? '' : 'hidden'; });
    }
    map.on('move', declutterSoon);
    map.on('resize', declutterSoon);

    map.on('load', () => {
      mapReady = true;
      addApexLayers();
      applySatellite();
      restyleBasemap();
      // U-68: the canvas shows only now it is ours. REVIEW_FEEL F-03: the cover lifts on the first frame that has the base map's
      // first tile in our style, not when the last tile and the terrain have come in: the rest fills in under the deck, as in
      // any map app. Idle (every tile) is the fallback, and boot.js's ceiling after that.
      const reveal = () => document.getElementById('map').classList.remove('unstyled');
      const lift = () => { map.off('data', firstTile); reveal(); ApexBoot.done(); };
      const firstTile = (e) => { if (e.dataType === 'source' && e.sourceId === 'openmaptiles' && e.tile) { map.off('data', firstTile); map.once('render', lift); } };
      map.on('data', firstTile);
      map.once('idle', lift);
      setTimeout(reveal, 1200);
      applyPower();
      map.setLayoutProperty('apex-dna', 'visibility', state.toggles.dna ? 'visible' : 'none');
      updateTwisty();
      map.on('moveend', () => { clearTimeout(twisty.timer); twisty.timer = setTimeout(updateTwisty, 600); });
      updateCoverage();
      map.on('moveend', () => { clearTimeout(coverage.timer); coverage.timer = setTimeout(updateCoverage, 700); });
      if (state.toggles.roadcams) map.once('idle', () => roadCamsLayer(true));   // left on last time: after the launch, never in its way
      if (track) loadTrackOnMap();
      // Tap a faint option on the map to take it.
      map.on('click', 'apex-alt', (e) => {
        if (state.tapToRoute || !e.features || !e.features.length) return;
        if (map.queryRenderedFeatures(e.point, { layers: ['apex-route'] }).length) return;   // a shared stretch: the drawn route wins
        suppressMapClickUntil = Date.now() + 400;
        pickOption(e.features[0].properties.i);
      });
      // Tap a measured road for what members measured there, in words (the colour is never the only way to read it).
      map.on('click', 'apex-coverage', (e) => {
        if (state.tapToRoute || Date.now() < suppressMapClickUntil || !e.features || !e.features.length) return;
        if (map.queryRenderedFeatures(e.point, { layers: ['apex-route', 'apex-alt', 'apex-explore'].filter((id) => map.getLayer(id)) }).length) return;   // a route drawn over it wins the tap
        const say = ApexCoverage.describe(coverage.cache.get(e.features[0].properties.way));
        if (say) toast(say);
      });
      // tap a place on the map: its card, by its name and kind, with Go here, Start from here and Add via (the dropped pin's)
      map.on('click', 'apex-places', (e) => {
        if (state.tapToRoute || state.mode === 'live' || Date.now() < suppressMapClickUntil || !e.features || !e.features.length) return;
        if (map.queryRenderedFeatures(e.point, { layers: ['apex-route', 'apex-alt', 'apex-explore'].filter((id) => map.getLayer(id)) }).length) return;
        const f = e.features[0], at = f.geometry && f.geometry.coordinates;
        if (!Array.isArray(at) || !f.properties.name) return;
        showPin({ lat: at[1], lon: at[0] }, { name: f.properties.name, kind: PLACE_WORD[f.properties.class] || '' });
      });
      map.on('mouseenter', 'apex-places', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'apex-places', () => { map.getCanvas().style.cursor = ''; });
      map.on('click', 'apex-explore', (e) => {
        if (state.tapToRoute || !e.features || !e.features.length) return;
        suppressMapClickUntil = Date.now() + 400;
        driveStage(e.features[0].properties.i);
      });
      map.on('click', (e) => {
        if (Date.now() < suppressMapClickUntil) return;
        if (!state.tapToRoute) return;
        if ($('planPanel').classList.contains('busy')) { toast('Still finding roads. Tap again in a moment.'); return; }
        state.tapToRoute = false;
        $('tapRouteBtn').classList.remove('on');
        setFieldPin(state.planField || 'destInput', { lat: e.lngLat.lat, lon: e.lngLat.lng });
        routeToQuery();
      });
    });
    // Twisty roads: the loop planner's stage finder run around the map centre as you look around.
    const twisty = { cache: new Map(), searched: [], busy: false, timer: 0 };
    async function updateTwisty() {
      if (!mapReady || !map.getLayer('apex-twisty')) return;
      const on = !!state.toggles.twisty && !!window.ApexTwisty && state.mode !== 'live';   // D-2: the idle map's; a drive never searches tiles for it
      map.setLayoutProperty('apex-twisty', 'visibility', on ? 'visible' : 'none');
      if (!on || twisty.busy) return;
      const c = map.getCenter(), b = map.getBounds();
      const halfDiagKm = Math.hypot((b.getNorth() - b.getSouth()) * 110.54, (b.getEast() - b.getWest()) * 111.32 * Math.cos(c.lat * Math.PI / 180)) / 2;
      const area = ApexTwisty.nextSearch({ lat: c.lat, lon: c.lng, zoom: map.getZoom(), halfDiagKm }, twisty.searched);
      if (!area) return;
      twisty.busy = true;
      try {
        const stages = await (ApexStages.discoverAsync || ApexStages.discover)({ lat: area.lat, lon: area.lon }, area.radiusKm);
        twisty.searched.push(area);
        if (twisty.searched.length > 40) twisty.searched.shift();
        if (ApexTwisty.add(twisty.cache, stages)) map.getSource('apex-twisty-src').setData(ApexTwisty.geojson(twisty.cache));
      } catch (_) { twisty.busy = false; return; }   // no tiles (offline): nothing drawn, try again on the next move
      twisty.busy = false;
      updateTwisty();   // the map may have moved on while this area was scored
    }

    // Measured roads: what members have measured around the view, from /api/coverage (members only; nothing drawn otherwise).
    const coverage = { cache: new Map(), had: [], busy: false, timer: 0, said: false };
    async function updateCoverage() {
      if (!mapReady || !map.getLayer('apex-coverage')) return;
      const on = !!state.toggles.coverage && !!window.ApexCoverage;
      map.setLayoutProperty('apex-coverage', 'visibility', on ? 'visible' : 'none');
      if (!on || coverage.busy) return;
      const b = map.getBounds(), box = ApexCoverage.boxFor({ s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast(), zoom: map.getZoom() });
      if (!box || ApexCoverage.inside(box, coverage.had)) return;
      coverage.busy = true;
      try {
        const r = await apiCall('GET', `/api/coverage?bbox=${box.join(',')}`);
        if (r.status === 401 || r.status === 403) {
          if (!coverage.said) askSignIn('see measured roads');
          coverage.said = true;
        } else if (r.ok) {
          coverage.had.push(box);
          if (coverage.had.length > 30) coverage.had.shift();
          if (ApexCoverage.add(coverage.cache, await r.json())) map.getSource('apex-coverage-src').setData(ApexCoverage.geojson(coverage.cache));
        }
      } catch (_) { /* offline: nothing new drawn */ }
      coverage.busy = false;
    }

    map.once('idle', () => document.querySelectorAll('.maplibregl-ctrl-attrib').forEach(a => a.classList.remove('maplibregl-compact-show')));
    // U-102: MapLibre opens the compact attribution again on its own (a theme's restyle empties and refills the sources, a
    // turn to landscape and back), which lands it over a replay or a drive like a toast. It stays behind its ⓘ key and opens
    // only when that key is tapped.
    let attribAsked = 0;
    // Apple's audit (app tour): the key's drawn "i" stood in for its name and its 4 pt frame for its 44 pt one; it is named
    document.querySelectorAll('.maplibregl-ctrl-attrib-button').forEach(b => { b.setAttribute('aria-label', 'Map credits'); b.title = 'Map credits'; });
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.maplibregl-ctrl-attrib-button')) attribAsked = performance.now(); }, true);
    // feedback 03: a written field (textarea.field) starts at its rows and grows with what's written, up to 40% of the screen
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || t.tagName !== 'TEXTAREA' || !t.classList.contains('field')) return;
      t.style.height = ''; if (t.scrollHeight > t.clientHeight) t.style.height = `${t.scrollHeight + 2}px`;
    });
    // feedback 04: a menu sheet (.side-pop) is modal. The scrim under it takes every tap outside it (nothing behind is
    // tappable) and slides the sheet away: through its own Done or Close, so what that key does on closing still happens.
    const popScrim = document.createElement('div'); popScrim.className = 'pop-scrim'; popScrim.setAttribute('aria-hidden', 'true');
    document.body.append(popScrim);
    popScrim.addEventListener('click', () => {
      document.querySelectorAll('.side-pop.open').forEach((p) => {
        const key = [...p.querySelectorAll('.side-pop-head button')].find((b) => /^(Done|Close|Cancel)$/.test(b.textContent.trim()));
        if (key) key.click();
        if (p.classList.contains('open')) p.classList.remove('open');
      });
    });
    // The owner, 2026-11-03: "i should be able to swipe this submenu out of the way". A menu sheet (.side-pop) that rises from
    // the bottom (it shows the grab handle) follows a finger dragged down from its top and, past 80 px or a quick flick,
    // closes through its own head key ("‹ Settings" back to the list, or Done), as a tap on the scrim does. Only the sheet
    // under the finger moves, so a sheet over the Settings list goes back to the list. The sheet's own scroll wins while it
    // isn't at its top, and fields, switches and sliders keep their touches. A desk's side panel (no handle) is left alone.
    (() => {
      const SWIPE_CLOSE_PX = 80, FLICK_PX_PER_MS = 0.5;
      const closeKey = (p) => { const keys = [...p.querySelectorAll('.side-pop-head button')]; return keys.find((b) => /^(‹|Done|Close|Cancel)/.test(b.textContent.trim())) || keys[0] || null; };
      const fromBottom = (p) => { const r = p.getBoundingClientRect(); return r.left <= 1 && Math.abs(window.innerHeight - r.bottom) <= 2; };
      let drag = null;
      document.addEventListener('touchstart', (e) => {
        const p = e.target.closest && e.target.closest('.side-pop.open');
        if (!p || e.touches.length !== 1 || !fromBottom(p) || p.scrollTop > 0) { drag = null; return; }
        if (e.target.closest('input, textarea, select, [role="slider"], .scrubber, .detents')) { drag = null; return; }
        drag = { p, y0: e.touches[0].clientY, x0: e.touches[0].clientX, t0: performance.now(), dy: 0, on: false };
      }, { passive: true });
      document.addEventListener('touchmove', (e) => {
        if (!drag) return;
        const dy = e.touches[0].clientY - drag.y0, dx = e.touches[0].clientX - drag.x0;
        if (!drag.on) {
          if (Math.abs(dx) > Math.abs(dy) || dy < -4 || drag.p.scrollTop > 0) { drag = null; return; }   // sideways, up, or a scroll
          if (dy < 8) return;
          drag.on = true; drag.p.style.transition = 'none';
        }
        drag.dy = Math.max(0, dy);
        drag.p.style.transform = `translateY(${drag.dy}px)`;
        if (e.cancelable) e.preventDefault();
      }, { passive: false });
      const end = () => {
        if (!drag) return;
        const { p, dy, t0, on } = drag; drag = null;
        if (!on) return;
        p.style.transition = ''; p.style.transform = '';
        if (dy > SWIPE_CLOSE_PX || dy / Math.max(1, performance.now() - t0) > FLICK_PX_PER_MS) {
          const key = closeKey(p);
          if (key) key.click();
          if (p.classList.contains('open')) p.classList.remove('open');
        }
      };
      document.addEventListener('touchend', end);
      document.addEventListener('touchcancel', end);
    })();
    const attribWatch = new MutationObserver((ms) => {
      for (const m of ms) {
        const a = m.target;
        if (a.classList.contains('maplibregl-compact-show') && !(m.oldValue || '').includes('maplibregl-compact-show') && performance.now() - attribAsked > 600) a.classList.remove('maplibregl-compact-show');
      }
    });
    map.getContainer().querySelectorAll('.maplibregl-ctrl-attrib').forEach((a) => attribWatch.observe(a, { attributes: true, attributeFilter: ['class'], attributeOldValue: true }));
    $('recenterBtn').addEventListener('click', () => { if (locDenied && !track && $('app').classList.contains('idle')) { showPerms(); return; } resumeFollow(); render(false); });   // the idle map with Location off has nowhere to come back to: say so

    // =======================================================================
    // 4b. CAMERA RIG — a chase cam that reacts to the car and the road, on its own 60 fps loop.
    //   * springs: position chases a speed-scaled look-ahead point; bearing aims 2-4 s down the
    //     road (swings into corners before the car does) and settles with an overshoot
    //   * sway: swings wide in proportion to lateral g, so the car sits on the inside
    //   * brake/throttle: pitch dips and zoom tightens under braking, pulls out under power
    //   * road texture: shake from measured pavement roughness, a kick at recorded bumps
    //   * override: any touch pauses follow; it glides back after FOLLOW_RESUME_S of no touch
    // =======================================================================
    // Low-power cockpit (web/power.js, IDEAS P-02): a hot phone, Low Power Mode or a low battery drops this loop to 30 fps
    // without shake, the map to 2x pixels, and hides hillshade and contours. Everything else (notes, recording) is unchanged.
    const power = new ApexPower.PowerSaver();
    const HEAVY_LAYERS = ['apex-hillshade', 'apex-contours', 'apex-contour-labels'];
    // F-05 (REVIEW_FEEL.md, the owner's call 2026-10-30): a drive draws less. Its cost is the map's drawing, not script, so
    // in a drive the canvas is capped at 2x pixels (the car already is: no sharper a glance at road speed), and at speed
    // the contour lines and their labels go (hillshade stays: the relief still reads) with the labels no one reads at a
    // glance (one-way arrows, water, paths, minor streets, airports). They come back once the car has stopped for a moment.
    // The street you turn onto is in the strip and the voice, never only on the map.
    const AT_SPEED_HIDE = ['apex-contours', 'apex-contour-labels', 'road_one_way_arrow', 'road_one_way_arrow_opposite', 'waterway_line_label',
      'water_name_point_label', 'water_name_line_label', 'highway-name-path', 'highway-name-minor', 'airport'];
    const AT_SPEED_MPS = 8, STOPPED_MPS = 1, STOPPED_S = 3;
    const drawDetail = { atSpeed: false, stoppedAt: 0, base: {}, pxCap: null, edges: false };   // pxCap: the ratio last set (null: MapLibre's own)
    // one step per live frame: above 8 m/s the drive is at speed; below 1 m/s for 3 s it has stopped (between the two it
    // stays as it was, so a slow corner or a rolling stop never flickers the map)
    function paceDetail(vMps) {
      if (state.mode !== 'live') return;
      let at = drawDetail.atSpeed;
      if (vMps > AT_SPEED_MPS) { at = true; drawDetail.stoppedAt = 0; }
      else if (vMps != null && vMps < STOPPED_MPS) { const now = performance.now(); if (!drawDetail.stoppedAt) drawDetail.stoppedAt = now; else if (now - drawDetail.stoppedAt >= STOPPED_S * 1000) at = false; }
      else drawDetail.stoppedAt = 0;
      if (at !== drawDetail.atSpeed) { drawDetail.atSpeed = at; applyPower(); }
    }
    // F-02 + F-05: a drive's map ends where its chrome starts (the strip, the binnacle), less a margin the chrome may grow or
    // shrink into without leaving a gap: what is under the chrome is not drawn. Set at a drive's start and end (and on a
    // rotation) only, with the pixel ratio, so the two make one resize; a status line or a strip that changes in the drive
    // does not move them.
    const MAP_EDGE_MARGIN = 28;
    function setDriveEdges(live) {
      const st = map.getContainer().style;
      for (const k of ['t', 'r', 'b', 'l']) st.removeProperty(`--map-${k}`);
      if (live) {
        const s = document.querySelector('#app > .stage').getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
        const edge = (px) => (px > MAP_EDGE_MARGIN ? `${Math.round(px - MAP_EDGE_MARGIN)}px` : null);
        const e = { t: edge(s.top), r: edge(W - s.right), b: edge(H - s.bottom), l: edge(s.left) };
        for (const k of Object.keys(e)) if (e[k]) st.setProperty(`--map-${k}`, e[k]);
      } else { drawDetail.atSpeed = false; drawDetail.stoppedAt = 0; }
      applyPower();
      measureStage();
    }
    window.addEventListener('resize', () => { if (state.mode === 'live') setDriveEdges(true); });
    function applyPower() {
      if (!mapReady) return;
      const dpr = window.devicePixelRatio || 1, live = state.mode === 'live', c = map.getContainer();
      // null hands the ratio back to MapLibre (follows zoom and screen changes); a drive or a hot phone caps it at 2
      const cap = power.low || live ? Math.min(dpr, 2) : null;
      if (cap !== drawDetail.pxCap || (cap == null && map.getPixelRatio() !== dpr)) { drawDetail.pxCap = cap; try { map.setPixelRatio(cap); } catch (_) {} }
      else if (c.clientWidth !== mapBox.w || c.clientHeight !== mapBox.h) map.resize();   // new edges at the same ratio: one resize
      const hide = new Set(power.low ? HEAVY_LAYERS : []);
      if (live && drawDetail.atSpeed) AT_SPEED_HIDE.forEach((id) => hide.add(id));
      for (const id of new Set([...HEAVY_LAYERS, ...AT_SPEED_HIDE])) {
        if (!map.getLayer(id)) continue;
        if (!(id in drawDetail.base)) drawDetail.base[id] = map.getLayoutProperty(id, 'visibility') || 'visible';   // the style's own (some start hidden)
        const want = hide.has(id) ? 'none' : drawDetail.base[id];
        if ((map.getLayoutProperty(id, 'visibility') || 'visible') !== want) map.setLayoutProperty(id, 'visibility', want);
      }
      applyTerrain();
    }
    // 3D terrain (IDEAS U-14): the hillshade's own DEM raised into relief, a little exaggerated so a ridge reads on a phone.
    // Off by default and off while saving battery (it is the heaviest thing the map can draw). Preview flies over it.
    // F-10 (REVIEW_FEEL): raising the mesh held the page for seconds (3 tasks, 3.5 s at 4x). From the switch (`later`), the
    // switch reads on at once, the pitch eases first and the terrain is set once the map has stopped and the page is idle,
    // with "Building 3D terrain" under the switch until the map has drawn it.
    let terrainRun = 0;
    function paintTerrainNote(on) { const n = $('terrainNote'); if (n && n.hidden === on) n.hidden = !on; }
    function applyTerrain(later = false) {
      if (!mapReady || !map.getSource('apex-dem')) return;
      const on = !!state.toggles.terrain && !power.low, run = ++terrainRun;
      const set = () => {
        if (run !== terrainRun) return;
        try { map.setTerrain(on ? { source: 'apex-dem', exaggeration: 1.4 } : null); } catch (_) {}
        const built = () => { if (run === terrainRun) paintTerrainNote(false); };
        if (on) { map.once('idle', built); setTimeout(built, 6000); } else paintTerrainNote(false);   // (no DEM tiles: the map never idles)
      };
      if (!later || !on) { set(); return; }
      paintTerrainNote(true);
      const go = () => idle(set);
      if (map.isMoving()) map.once('moveend', go); else go();
    }
    let webBattery = null;   // a browser's own battery reading, for what a drive costs (battery_budget.js, IDEAS P-01)
    function feedPower(info) {
      if (!power.update(info)) return;
      applyPower();
      toast(power.low ? `${power.reason} · saving battery: map at 30 fps, terrain shading off` : 'Full map detail back on.');
    }
    if (navigator.getBattery) navigator.getBattery().then((b) => {
      const read = () => { webBattery = { level: b.level, charging: b.charging }; feedPower({ batteryLevel: b.level, charging: b.charging }); };
      read(); b.addEventListener('levelchange', read); b.addEventListener('chargingchange', read);
    }).catch(() => {});
    const CAM_FEEL = {
      steady:  { wPos: 3.4, zPos: 1.00, wBear: 1.8, zBear: 0.95, lead: 0.8, ahead: 1.8, sway: 0.0, punch: 0.3, shake: 0.25 },
      dynamic: { wPos: 3.0, zPos: 0.80, wBear: 3.0, zBear: 0.55, lead: 1.0, ahead: 2.6, sway: 1.0, punch: 1.0, shake: 1.0 },
      whip:    { wPos: 2.6, zPos: 0.65, wBear: 4.2, zBear: 0.42, lead: 1.3, ahead: 3.6, sway: 1.6, punch: 1.5, shake: 1.5 }
    };
    const FOLLOW_RESUME_S = 6;
    const cam = { ready: false };
    let vehicle = null;
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const clampS = (x, a) => Math.max(-a, Math.min(a, x));
    function setVehicle(v, snap) { vehicle = v; if (snap || !cam.ready) resetCamera(); }
    function offsetPoint(lat, lon, bearingDegs, m) {
      const b = bearingDegs * Math.PI / 180;
      return [lat + m * Math.cos(b) / 110540, lon + m * Math.sin(b) / (111320 * Math.cos(lat * Math.PI / 180))];
    }
    function aheadPoint(m) {
      if (vehicle.onTrack && track) { const s = sample(track, state.cursorM + m); return [s.lat, s.lon]; }   // track: the plan cleared after a drive on it
      return offsetPoint(vehicle.lat, vehicle.lon, vehicle.bearing, m);
    }
    function camTargets() {
      const f = CAM_FEEL[state.camFeel] || CAM_FEEL.dynamic, v = vehicle.vMps;
      let [cLat, cLon] = aheadPoint(Math.max(15, Math.min(90, v * f.lead)));
      const [bLat, bLon] = aheadPoint(Math.max(35, Math.min(200, v * f.ahead)));
      const brg = vehicle.onTrack ? bearingDeg(vehicle.lat, vehicle.lon, bLat, bLon) : vehicle.bearing;
      // Swing wide: +lat (left turn) pushes the view to the right of the heading.
      const lat = vehicle.latG || 0, lon = vehicle.lonG || 0;
      [cLat, cLon] = offsetPoint(cLat, cLon, brg + 90, clampS(lat / 0.6, 1) * 16 * f.sway);
      const brake = clamp01(-lon / 0.5), power = clamp01(lon / 0.35);
      return {
        lat: cLat, lon: cLon, bearing: brg,
        zoom: 16.4 - 1.8 * clamp01((v - 8) / 30) + f.punch * (0.35 * brake - 0.3 * power),
        pitch: 42 + 12 * clamp01(v / 35) + f.punch * 5 * brake
      };
    }
    let camResets = 0;                                                   // e2e: a reroute while driving resets nothing
    function resetCamera(fromMap = false) {
      if (!vehicle) return;
      camResets++;
      const t = camTargets();
      const c = fromMap ? map.getCenter() : null;
      Object.assign(cam, {
        ready: true,
        lat: c ? c.lat : t.lat, lon: c ? c.lng : t.lon, bearing: fromMap ? map.getBearing() : t.bearing,
        zoom: fromMap ? map.getZoom() : t.zoom, pitch: fromMap ? map.getPitch() : t.pitch,
        vLat: 0, vLon: 0, vBear: 0, vZoom: 0, vPitch: 0, kick: 0,
        ...(fromMap ? {} : { pLat: vehicle.lat, pLon: vehicle.lon, pBear: vehicle.bearing, pvLat: 0, pvLon: 0, pvBear: 0 })
      });
    }
    function spring(x, v, target, w, z, dt) {
      const a = w * w * (target - x) - 2 * z * w * v;
      v += a * dt;
      return [x + v * dt, v];
    }
    // Smooth pseudo-noise (incommensurate sines) for road texture.
    const texture = (t, seed) => Math.sin(t * 43.1 + seed) * 0.5 + Math.sin(t * 71.7 + seed * 2.3) * 0.3 + Math.sin(t * 97.3 + seed * 4.1) * 0.2;
    let camLast = 0, lastBumpKey = '';
    // Perf (the owner's drive, 2026-10-30: "laggy"): the springs only ever approach their targets, so the loop used to move the
    // map by a hair every frame forever and the map redrew 60 times a second standing still. A move under what a pixel shows
    // is not sent; the map then sleeps until something changes. The map's height is read on resize, not every frame (a read
    // after the marker writes forced a layout each frame).
    let camSent = null, puckSent = null, camMapH = 0;
    map.on('resize', () => { camMapH = map.getContainer().clientHeight || 0; });
    const camSame = (a, b) => !!a && !!b && Math.abs(a.lon - b.lon) < 1e-7 && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.bearing - b.bearing) < 0.01
      && Math.abs(a.zoom - b.zoom) < 5e-4 && Math.abs(a.pitch - b.pitch) < 0.01 && a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
    const camNow = () => { const c = map.getCenter(), p = map.getPadding(); return { lon: c.lng, lat: c.lat, bearing: map.getBearing(), zoom: map.getZoom(), pitch: map.getPitch(), top: p.top, bottom: p.bottom, left: p.left, right: p.right }; };
    function cameraFrame(ts) {
      requestAnimationFrame(cameraFrame);
      if (!power.frameDue(ts)) return;
      const dt = Math.min(0.05, (ts - (camLast || ts)) / 1000);
      camLast = ts;
      if (!vehicle || !cam.ready || dt <= 0) return;
      [cam.pLat, cam.pvLat] = spring(cam.pLat, cam.pvLat, vehicle.lat, 14, 1, dt);
      [cam.pLon, cam.pvLon] = spring(cam.pLon, cam.pvLon, vehicle.lon, 14, 1, dt);
      [cam.pBear, cam.pvBear] = spring(cam.pBear, cam.pvBear, cam.pBear + angleDelta(cam.pBear, vehicle.bearing), 10, 1, dt);
      if (!puckSent || Math.abs(cam.pLat - puckSent.lat) > 1e-8 || Math.abs(cam.pLon - puckSent.lon) > 1e-8 || Math.abs(cam.pBear - puckSent.bear) > 0.01) {
        puckSent = { lat: cam.pLat, lon: cam.pLon, bear: cam.pBear };
        puck.setLngLat([cam.pLon, cam.pLat]).setRotation(cam.pBear);
        sightTag.setLngLat([cam.pLon, cam.pLat]);
      }
      if (!state.follow) return;
      const f = CAM_FEEL[state.camFeel] || CAM_FEEL.dynamic, t = camTargets();
      [cam.lat, cam.vLat] = spring(cam.lat, cam.vLat, t.lat, f.wPos, f.zPos, dt);
      [cam.lon, cam.vLon] = spring(cam.lon, cam.vLon, t.lon, f.wPos, f.zPos, dt);
      [cam.bearing, cam.vBear] = spring(cam.bearing, cam.vBear, cam.bearing + angleDelta(cam.bearing, t.bearing), f.wBear, f.zBear, dt);
      [cam.zoom, cam.vZoom] = spring(cam.zoom, cam.vZoom, t.zoom, 2.0, 0.8, dt);
      [cam.pitch, cam.vPitch] = spring(cam.pitch, cam.vPitch, t.pitch, 2.0, 0.8, dt);

      // Road texture: measured roughness (g RMS) sets a fine shake; a recorded bump within 15 m kicks it.
      const bump = track && track.events.find(e => e.type === 'bump' && Math.abs(e.dist_m - state.cursorM) < 15);   // (no copy a frame: allEvents' cameras are never bumps)
      const key = bump ? `${bump.index}` : '';
      if (bump && key !== lastBumpKey) cam.kick = Math.min(1.5, bump.severity_g * 2.2);
      lastBumpKey = key;
      cam.kick *= Math.exp(-dt * 6);
      const amp = (power.low ? 0 : f.shake) * (clamp01((vehicle.rough || 0) / 0.25) * 0.6 + cam.kick) * clamp01(vehicle.vMps / 6);
      const tt = ts / 1000;
      const [sLat, sLon] = offsetPoint(cam.lat, cam.lon, cam.bearing + 90, amp * 1.2 * texture(tt, 1));
      // U-84: in a drive the view sits low, so the road ahead gets the screen: the camera's point (a little ahead of the arrow)
      // at 55 % of the map's height under 25 mph, easing to 68 % by 40 mph, which puts the arrow near 70 %; idle, the middle
      const fy = state.mode === 'live' ? 0.55 + 0.13 * clamp01((vehicle.vMps - 11.2) / 6.7) : 0.5;
      cam.fy = Number.isFinite(cam.fy) ? cam.fy + (fy - cam.fy) * Math.min(1, dt * 1.2) : fy;
      const mapH = camMapH || (camMapH = map.getContainer().clientHeight || 0);
      // F-02: the fraction is of the part of the map the chrome leaves (the strip above, the binnacle below lie over the
      // map); the chrome's edges are eased like fy, so a status line taking a second row glides the view, never jumps it
      for (const k of ['t', 'b', 'l', 'r']) cam['v' + k] = Number.isFinite(cam['v' + k]) ? cam['v' + k] + (stageView[k] - cam['v' + k]) * Math.min(1, dt * 3) : stageView[k];
      const visH = Math.max(1, mapH - cam.vt - cam.vb);
      const next = { lon: sLon, lat: sLat, bearing: ((cam.bearing + amp * 0.5 * texture(tt, 7)) % 360 + 360) % 360,
        zoom: cam.zoom, pitch: Math.max(0, Math.min(60, cam.pitch + amp * 0.9 * texture(tt, 13))), top: Math.max(0, Math.round(cam.vt + (2 * cam.fy - 1) * visH)),
        bottom: Math.round(cam.vb), left: Math.round(cam.vl), right: Math.round(cam.vr) };
      // skipped only while the map still sits where this loop last put it (a gesture, a fit or a resize moves it: sent again)
      if (camSent && camSame(next, camSent.to) && camSame(camNow(), camSent.at)) return;
      map.jumpTo({ center: [next.lon, next.lat], bearing: next.bearing, zoom: next.zoom, pitch: next.pitch, padding: { top: next.top, bottom: next.bottom, left: next.left, right: next.right } });
      camSent = { to: next, at: camNow() };
    }
    requestAnimationFrame(cameraFrame);

    // Manual override: any user gesture pauses follow; it resumes FOLLOW_RESUME_S after the last touch.
    let resumeTimer = null, resumeTick = null;
    function pauseFollow() {
      state.follow = false;
      clearTimeout(resumeTimer); clearInterval(resumeTick);
      $('recenterBtn').classList.add('show');
      recenterLeft(0);
    }
    // the app's own camera move (a route fit): follow pauses with no recenter key; a drag of the map brings it (U-122)
    function holdFollow() { state.follow = false; clearTimeout(resumeTimer); clearInterval(resumeTick); recenterLeft(0); }
    function scheduleResume() {
      clearTimeout(resumeTimer); clearInterval(resumeTick);
      let left = FOLLOW_RESUME_S;
      recenterLeft(left);
      resumeTick = setInterval(() => { left -= 1; if (left > 0) recenterLeft(left); }, 1000);
      resumeTimer = setTimeout(resumeFollow, FOLLOW_RESUME_S * 1000);
    }
    // U-71: the key's face is always the glyph; a countdown drains a bar along its foot (restarted for each new one), and
    // the seconds go only to its label
    function recenterLeft(s) {
      const b = $('recenterBtn'), bar = b.querySelector('.rc-left');
      if (s === FOLLOW_RESUME_S) { b.classList.remove('counting'); void bar.offsetWidth; b.style.setProperty('--rc-s', `${s}s`); }
      b.classList.toggle('counting', s > 0);
      b.setAttribute('aria-label', s > 0 ? `Recenter (on its own in ${s} s)` : 'Recenter');
    }
    function resumeFollow() {
      clearTimeout(resumeTimer); clearInterval(resumeTick);
      resetCamera(true);          // glide back from wherever the user left the view
      state.follow = true;
      $('recenterBtn').classList.remove('show');
    }
    // Pause on first contact: the follow loop's jumpTo would otherwise cancel the gesture. U-71: but only a gesture that moves
    // the map (a drag, a pinch, a second finger) shows the key and counts down; a tap leaves follow as it was, and the app's
    // own camera moves (a route fit, a drive start) never count.
    const mapEl = map.getCanvasContainer();
    let droppedPin = null, pinMarker = null, pinLookup = 0, suppressMapClickUntil = 0;
    const activeMapPointers = new Set();
    let hold = null;
    function cancelHold() { if (hold) clearTimeout(hold.timer); hold = null; }
    function closePin() {
      pinLookup++;
      $('pinOverlay').classList.remove('show');
      if (pinMarker) { pinMarker.remove(); pinMarker = null; }
      droppedPin = null;
    }
    async function reversePin(p) {
      const lookup = ++pinLookup;
      let name = '--';
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(p.lat)}&lon=${encodeURIComponent(p.lon)}&zoom=18&addressdetails=1`);
        if (response.ok) {
          const place = await response.json();
          name = place.name || place.address?.road || place.address?.hamlet || place.address?.village || place.address?.town || place.address?.city || place.display_name?.split(',')[0] || '--';
        }
      } catch (_) { /* An offline or unnamed place remains unknown. */ }
      if (lookup === pinLookup && droppedPin === p) $('pinPlace').textContent = name;
    }
    // place: a place tapped on the map ({ name, kind }): its card says its name and kind and how far, with no lookup
    function showPin(point, place = null) {
      if (state.mode === 'live') return;
      closePin();
      droppedPin = point;
      const markerEl = document.createElement('div'); markerEl.className = 'dropped-pin';
      pinMarker = new maplibregl.Marker({ element: markerEl }).setLngLat([point.lon, point.lat]).addTo(map);
      $('pinPlace').textContent = place ? place.name : '--';
      const here = state.lastPosition, far = place && here ? FunRoute.kmBetween(here, point) * 1000 : null;
      $('pinKind').textContent = place ? [place.kind, Number.isFinite(far) ? ApexUnits.long(far) : ''].filter(Boolean).join(' · ') : '';
      $('pinKind').hidden = !$('pinKind').textContent;
      $('pinOverlay').setAttribute('aria-label', place ? place.name : 'Dropped pin');
      $('pinViaBtn').hidden = !plannedRoute?.request;
      $('pinOverlay').classList.add('show');
      suppressMapClickUntil = Date.now() + 700;
      placeInfo(null);
      if (!place) reversePin(point);
      else if (window.ApexPlaceInfo) {                                  // hours, phone and site, once known (place_info.js)
        const asked = droppedPin;
        ApexPlaceInfo.lookup(place.name, point.lat, point.lon).then((tags) => { if (droppedPin === asked && tags) placeInfo(ApexPlaceInfo.contact(tags, new Date())); }).catch(() => {});
      }
    }
    // the card's open-now line and Call / Website keys; null clears them (a dropped pin, or nothing known)
    function placeInfo(c) {
      const h = $('pinHours'), box = $('pinContact');
      h.hidden = !(c && c.hours); h.className = 'pin-hours' + (c && c.hours ? (c.hours.open ? ' open' : ' closed') : '');
      h.textContent = c && c.hours ? c.hours.text : '';
      const keys = c ? [c.phone && ['Call', c.phone, `Call ${c.phone.text}`], c.web && ['Website', c.web, `Website, ${c.web.text}`]].filter(Boolean) : [];
      box.replaceChildren(...keys.map(([label, x, aria]) => { const a = document.createElement('a'); a.className = 'ink-btn'; a.href = x.href; a.textContent = label;
        a.setAttribute('aria-label', aria); if (/^https?:/.test(x.href)) { a.target = '_blank'; a.rel = 'noopener'; } return a; }));
      box.hidden = !keys.length;
    }
    mapEl.addEventListener('pointerdown', (e) => {
      activeMapPointers.add(e.pointerId);
      cancelHold();
      if (state.mode === 'live' || activeMapPointers.size !== 1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
      hold = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: setTimeout(() => {
        if (!hold || hold.id !== e.pointerId || activeMapPointers.size !== 1 || state.mode === 'live') return;
        const rect = mapEl.getBoundingClientRect();
        const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        cancelHold();
        showPin({ lat: ll.lat, lon: ll.lng });
      }, 500) };
    }, { capture: true });
    mapEl.addEventListener('pointermove', (e) => {
      if (hold?.id === e.pointerId && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) cancelHold();
    }, { capture: true });
    mapEl.addEventListener('pointerleave', cancelHold, { capture: true });
    mapEl.addEventListener('contextmenu', (e) => { if (Date.now() < suppressMapClickUntil) e.preventDefault(); });
    mapEl.addEventListener('touchstart', (e) => { if (e.touches.length > 1) cancelHold(); }, { capture: true, passive: true });
    map.on('dragstart', cancelHold);
    map.on('zoomstart', (e) => { if (e.originalEvent) cancelHold(); });
    window.addEventListener('pointerup', (e) => { activeMapPointers.delete(e.pointerId); if (hold?.id === e.pointerId) cancelHold(); });
    window.addEventListener('pointercancel', (e) => { activeMapPointers.delete(e.pointerId); cancelHold(); });
    // Drag the planned route to reshape it (IDEAS R-18): a mouse grabs the line at once; a finger holds still on it for a
    // moment first (so panning across the route still pans). Let go somewhere else and that becomes a stop, in the order of
    // the point you grabbed; held and let go without moving, it is the long-press pin as before.
    let reshape = null;
    const ROUTE_HIT_PX = 12, RESHAPE_HOLD_MS = 350;
    const reshapeable = () => !!(plannedRoute && plannedRoute.request && track === plannedRoute && state.mode !== 'live' && !state.playing);
    function onRouteAt(x, y) {
      try { return map.queryRenderedFeatures([[x - ROUTE_HIT_PX, y - ROUTE_HIT_PX], [x + ROUTE_HIT_PX, y + ROUTE_HIT_PX]], { layers: ['apex-route', 'apex-route-casing'] }).length > 0; } catch (_) { return false; }
    }
    function endReshape() {
      if (!reshape) return;
      clearTimeout(reshape.timer);
      if (reshape.marker) reshape.marker.remove();
      if (reshape.active) map.dragPan.enable();
      reshape = null;
    }
    function beginReshape(r) {
      cancelHold();
      r.active = true; map.dragPan.disable();
      const el = document.createElement('div'); el.className = 'dropped-pin reshape-pin';
      r.marker = new maplibregl.Marker({ element: el }).setLngLat(map.unproject([r.x, r.y])).addTo(map);
      if (r.touch) haptic('note');
    }
    mapEl.addEventListener('pointerdown', (e) => {
      endReshape();
      if (!reshapeable() || activeMapPointers.size !== 1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const rect = mapEl.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (!onRouteAt(x, y)) return;
      const ll = map.unproject([x, y]), t = plannedRoute;
      reshape = { id: e.pointerId, x, y, x0: x, y0: y, t0: Date.now(), touch: e.pointerType !== 'mouse', active: false, moved: false, t,
                  atM: t.dist[Core.nearestIndex(ll.lat, ll.lng, t.lat, t.lon, -1).index] };
      if (!reshape.touch) beginReshape(reshape);
      else { const r = reshape; r.timer = setTimeout(() => { if (reshape === r && !r.moved) beginReshape(r); }, RESHAPE_HOLD_MS); }
    }, { capture: true });
    mapEl.addEventListener('pointermove', (e) => {
      if (!reshape || reshape.id !== e.pointerId) return;
      const rect = mapEl.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (Math.hypot(x - reshape.x0, y - reshape.y0) > 8) reshape.moved = true;
      if (!reshape.active) { if (reshape.moved) endReshape(); return; }   // a finger that moves first is panning the map
      reshape.x = x; reshape.y = y;
      reshape.marker.setLngLat(map.unproject([x, y]));
    }, { capture: true });
    window.addEventListener('pointerup', (e) => {
      const r = reshape;
      if (!r || r.id !== e.pointerId) return;
      if (!r.active || !r.moved || plannedRoute !== r.t) {
        const held = r.active && !r.moved && (r.touch || Date.now() - r.t0 >= 500);
        endReshape();
        if (held) { const ll = map.unproject([r.x, r.y]); showPin({ lat: ll.lat, lon: ll.lng }); }   // the long-press pin, as before
        return;
      }
      const ll = map.unproject([r.x, r.y]);
      suppressMapClickUntil = Date.now() + 700;                           // the release is not a map tap
      endReshape();
      addViaAt({ lat: ll.lat, lon: ll.lng }, r.atM);
    });
    window.addEventListener('pointercancel', endReshape);
    let touching = 0, gesture = null;
    mapEl.addEventListener('pointerdown', (e) => {
      touching++;
      if (!gesture) gesture = { x: e.clientX, y: e.clientY, following: state.follow, moved: false };
      else gesture.moved = true;                                           // a second finger: a pinch or a turn
      if (gesture.moved) pauseFollow();
      else state.follow = false;                                           // hold the camera still under the finger; no key yet
    }, { capture: true });
    window.addEventListener('pointermove', (e) => {
      if (!touching || !gesture || gesture.moved || Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 8) return;
      gesture.moved = true; pauseFollow();
    });
    const endGesture = () => {
      if (!touching) return;
      touching = 0;
      const g = gesture; gesture = null;
      if (g && !g.moved) { if (g.following) state.follow = true; return; }   // a tap: everything as it was
      if (!state.follow) scheduleResume();
    };
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    let wheelIdle = null;
    mapEl.addEventListener('wheel', () => { pauseFollow(); clearTimeout(wheelIdle); wheelIdle = setTimeout(scheduleResume, 250); }, { capture: true, passive: true });
    // a move the driver made with no finger down (a double-tap zoom, the keys) counts like a drag; the app's own moves carry no event
    map.on('movestart', (e) => { if (e.originalEvent && !touching && e.originalEvent.type !== 'wheel') { pauseFollow(); scheduleResume(); } });

    function loadTrackOnMap() {
      if (!track) return;
      const show = revealOf(track);
      if (!mapReady) return;
      map.getSource('apex-route-src').setData(routeGeoJSON(track));
      penDraw(track, show.lineMs);
      rebuildPins();
      paintAlternates();
    }
    // The reveal (design pass, 2026-11-10; web/route_reveal.js): a route just found is drawn onto the map from its start to
    // its end like a pen stroke, its profile is drawn on the card with it and the card's numbers count up. Another route
    // of the same plan (a level card, a loop's way, the ranked route) redraws quickly; a route put up again (a fly-through,
    // members' corners) is already drawn; reduced motion, a launch, a drive or a driven road: a cut. Worked out once per
    // route, here where every track reaches the map, and read by the card (cardReveal).
    let revealLast = null, cardReveal = null;
    function revealOf(t) {
      const none = { lineMs: 0, countMs: 0 };
      if (revealLast === t) return none;
      const prev = revealLast;
      revealLast = t;
      let still = true;
      try { still = booting || state.mode === 'live' || matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { still = true; }
      const show = window.ApexReveal && t.kind === 'route' && !t.sectors ? ApexReveal.plan(prev && prev.kind === 'route' ? prev : null, t, still) : none;
      cardReveal = { t, ms: show.lineMs, countMs: show.countMs, at: performance.now() };
      return show;
    }
    // The line itself, by its own progress (line-gradient over the source's lineMetrics). The gradient is taken off at the
    // end (and by a timer, should the frames stop: a hidden tab), so the line is never left half drawn and the look's
    // line-color rules again.
    const PEN_LAYERS = ['apex-route-casing', 'apex-route'];
    let pen = null, penCarry = false;
    function penStop() {
      if (!pen) return;
      cancelAnimationFrame(pen.raf); clearTimeout(pen.timer); pen = null;
      try { for (const id of PEN_LAYERS) if (map.getLayer(id)) map.setPaintProperty(id, 'line-gradient', undefined); } catch (_) { /* the map went (a lost context): nothing to tidy */ }
    }
    function penDraw(t, ms) {
      if (pen && pen.t === t && !(ms > 0)) return;                      // the same route sent again mid-stroke: the stroke carries on
      // another route while the pen is still down (the ranked route lands inside the first stroke): the pen carries on from
      // where it was along the new line, it never goes back to the start
      // the ranking's route after a stroke has finished (penCarry): the line is already whole, so it is whole at once
      const from = pen && ms > 0 ? pen.p : 0, carried = !pen && penCarry;
      penStop();
      if (!(ms > 0) || carried || !window.ApexReveal) return;
      const C = look.colors, cols = { 'apex-route-casing': C.routeCasing, 'apex-route': C.route }, t0 = performance.now();
      const at = (p) => { me.p = p; for (const id of PEN_LAYERS) if (map.getLayer(id)) map.setPaintProperty(id, 'line-gradient', ApexReveal.gradient(cols[id], p)); };
      const me = pen = { t, p: from, raf: 0, timer: setTimeout(() => { if (pen === me) penStop(); }, ms + 250) };
      const frame = (now) => {
        if (pen !== me) return;
        const f = (now - t0) / ms;
        if (f >= 1) { penStop(); return; }
        try { at(from + (1 - from) * ApexReveal.ease(f)); } catch (_) { penStop(); return; }
        me.raf = requestAnimationFrame(frame);
      };
      try { at(from); } catch (_) { penStop(); return; }
      me.raf = requestAnimationFrame(frame);
    }

    // =======================================================================
    // 5. SCRUBBER (pace profile = braking envelope, elevation behind it)
    // =======================================================================
    const scrubCanvas = $('scrubCanvas'), sctx = scrubCanvas.getContext('2d');
    // Perf: the canvas's box, kept by a ResizeObserver (read where layout is already done); reading it on each draw forced
    // a layout of the page several times a second in a drive, after the gauges had just been written
    let scrubRect = null;
    if (window.ResizeObserver) new ResizeObserver(() => { scrubRect = scrubCanvas.getBoundingClientRect(); drawScrubber(); }).observe(scrubCanvas);
    // What VoiceOver reads on the scrubber: "2.4 of 35.6 mi". Set only when the words change.
    function paintScrubValue() {
      const T = totalM(), at = Math.max(0, Math.min(T, state.cursorM || 0));
      const text = `${ApexUnits.longN(at).toFixed(1)} of ${ApexUnits.long(T, 1)}`, el = $('scrubber');
      if (el.getAttribute('aria-valuetext') === text) return;
      el.setAttribute('aria-valuetext', text);
      el.setAttribute('aria-valuenow', String(T > 0 ? Math.round(at / T * 100) : 0));
    }
    function drawScrubber() {
      const r = scrubRect || scrubCanvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
      if (scrubCanvas.width !== w || scrubCanvas.height !== h) { scrubCanvas.width = w; scrubCanvas.height = h; }
      sctx.clearRect(0, 0, w, h);
      if (!track) return;
      paintScrubValue();
      const C = look.colors, n = track.dist.length, T = totalM(), step = Math.max(1, Math.floor(n / w)), xOf = (m) => (m / T) * w;
      if (track.elev) {
        let lo = Infinity, hi = -Infinity;
        for (const e of track.elev) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
        const span = Math.max(10, hi - lo);
        sctx.beginPath(); sctx.moveTo(0, h);
        for (let i = 0; i < n; i += step) sctx.lineTo(xOf(track.dist[i]), h - 2 * dpr - ((track.elev[i] - lo) / span) * (h - 6 * dpr));
        sctx.lineTo(w, h); sctx.closePath(); sctx.fillStyle = C.rule; sctx.fill();
      }
      sctx.beginPath();
      let envelopeRun = false;
      for (let i = 0; i < n; i += step) {
        const env = track.envMps && track.envMps[i];
        if (!Number.isFinite(env)) { envelopeRun = false; continue; }
        const y = h - 2 * dpr - Math.min(1, env / 56) * (h - 4 * dpr);
        envelopeRun ? sctx.lineTo(xOf(track.dist[i]), y) : sctx.moveTo(xOf(track.dist[i]), y);
        envelopeRun = true;
      }
      sctx.strokeStyle = C.panelDim; sctx.lineWidth = 1.2 * dpr; sctx.stroke();
      for (const e of allEvents()) {
        if (e.type === 'corner' && (e.severity === 'HP' || e.severity <= 2)) { sctx.fillStyle = C.accent; sctx.fillRect(xOf(e.dist_m) - dpr, 0, 2 * dpr, 4 * dpr); }
        else if (e.type === 'alpr' && state.toggles.lpr) { sctx.fillStyle = C.signal; sctx.fillRect(xOf(e.dist_m) - dpr, h - 5 * dpr, 2 * dpr, 5 * dpr); }
      }
      sctx.fillStyle = C.signal; sctx.fillRect(xOf(state.cursorM) - 1.5 * dpr, 0, 3 * dpr, h);
    }

    // =======================================================================
    // 6. CO-DRIVER — quiet in cruise, full pace notes when spirited or STAGE
    // =======================================================================
    const allEvents = () => (track ? track.events.concat(track.alpr || [], track.marks || []) : []);   // marks: road_marks.js
    const distLabel = (m) => ApexUnits.short(m);          // feet and miles, or metres and km (Settings → Units, U-22)
    // Auto: wake on the road ahead (a corner that is tight or needs braking, updateNotes, U-58) or on hard driving. Full:
    // always awake. Quiet: never wake, so only cameras and severe bumps are called.
    const isSpirited = () => state.notesMode === 'full' || (state.notesMode === 'auto' && performance.now() - state.spiritedAt < 30000);
    // a bump several members felt (IDEAS Q-02) is called in cruise as well: verified, not one phone's guess
    // and a mapped deer crossing from dusk to dawn (road_marks.js cruiseWorthy): the sun's height where the car is, once a minute and for each new track
    const sunAlt = { at: 0, v: null, t: null };
    const sunAltNow = () => {
      const now = Date.now(), t = track, i = Math.max(0, state.cursorIdx || 0);
      if ((now - sunAlt.at > 60000 || sunAlt.t !== t) && window.ApexSun && t && t.lat && Number.isFinite(t.lat[i])) { sunAlt.at = now; sunAlt.t = t; sunAlt.v = ApexSun.sunPosition(new Date(), t.lat[i], t.lon[i]).altitude; }
      return sunAlt.v;
    };
    const noteworthyInCruise = (e) => e.type === 'alpr' || (e.type === 'bump' && (e.severity_g >= 0.45 || !!e.crowd))
      || (e.type === 'mark' && window.ApexRoadMarks && ApexRoadMarks.cruiseWorthy(e, sunAltNow()));

    // -------------------------------------------------------------------------
    // Voice: the most natural voice installed, read like a real co-driver.
    // -------------------------------------------------------------------------
    let privacyZones = (() => { try { return ApexPrivacyZones.load(localStorage); } catch (_) { return []; } })();   // privacy_zones.js
    const inPrivacyZone = (lat, lon) => !!ApexPrivacyZones.zoneAt(privacyZones, lat, lon);
    // VI-1: a "near me" lookup (hazards, meets, crews) never goes from a privacy zone, nor before a drive's private edge:
    // the first km at least, or the private edge the road data skips when that is longer (contributor.js privateEdge, up to
    // 1.5 km), so the first lookup isn't a fixed distance from home. feedReported counts the drive's distance.
    const lookupEdge = { on: false, m: 0, edgeM: 1000, last: null };
    const nearLookupOk = (p) => !!p && ApexPrivacyZones.mayLookUp(privacyZones, p.lat, p.lon, lookupEdge.on ? lookupEdge.m : Infinity, lookupEdge.edgeM);
    // queue: what to say next, hazards first, stale and duplicate lines dropped (speech_queue.js, IDEAS V-03). current: the line playing.
    // talkingUntil: the native voice's estimated end (it reports no finish).
    const speech = { busy: false, queue: ApexSpeechQueue.createSpeechQueue(), current: null, talkingUntil: 0, nativeTimer: 0, via: null, chime: null };
    const MEMO_S = 5;   // a remembered coaching tip takes up to this long to say
    let brakeSay = null;  // the brake heat call waiting for a quiet moment (noteBrakes), said before a break cue
    let briefSay = null;  // the stage briefing as a planned drive starts (briefing.js), after a limit call
    let alongSay = null;     // the last fuel before a long stretch with none, a viewpoint (along_ahead.js), after corners ahead
    let cornersSay = null;   // a twisty section after a long quiet stretch of the planned route (corners_ahead.js), after the briefing
    let limitSay = null;  // "Limit 35 ahead." waiting for a quiet moment (limit_ahead.js, the notes loop), before all the others
    let sunSay = null;    // "Sun in your eyes ahead." waiting for a quiet moment (sun_ahead.js, the notes loop), after brake heat
    let breakSay = null;  // a break suggestion waiting for a quiet moment (noteRest sets it, the notes loop says it)
    let flowSay = null, flowQueue = [];   // flowQueue: the next ones, in order, when two land close together; "Five clean in a row." (noteFlow, flow_live.js), the lowest of the quiet slots, never in Quiet notes
    const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const TENS = { 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty' };
    // Co-drivers say "one-fifty", "two hundred", "thirty" — never "one hundred and fifty".
    function codriverDistance(d) {
      if (TENS[d]) return TENS[d];
      const h = Math.floor(d / 100), r = d % 100;
      if (r === 0) return `${NUM_WORDS[h]} hundred`;
      return `${NUM_WORDS[h]}-${TENS[r] || (r === 20 ? 'twenty' : String(r))}`;
    }
    function spokenTextFor(text, style) {
      const keep = state.voiceStyle;
      state.voiceStyle = style;
      try { return spokenText(text, true); } finally { state.voiceStyle = keep; }
    }
    // rhythm: for the open-model voices only (device TTS would read the dots aloud). A co-driver runs a
    // chunk together and breathes before the caution and before the distance (tools/voicebank.py tts_text).
    function spokenText(text, rhythm = false) {
      const spoken = text.replace(/, (\d{2,3})$/, (_, d) => `${rhythm ? ' ...' : ','} ${codriverDistance(parseInt(d, 10))}`);
      return rhythm ? spoken.replace(/, (care|caution|double caution|triple caution)\b/g, ' ..... $1') : spoken;
    }
    // Rank installed voices: neural/premium first, British English (the co-driver accent), then any English.
    function pickVoice(style) {
      const voices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
      if (state.voiceName) { const v = voices.find(x => x.name === state.voiceName); if (v) return v; }
      const score = (v) => (/natural|neural|premium|enhanced|online/i.test(v.name) ? 10 : 0) + (/^en-GB/i.test(v.lang) ? 4 : 0) +
        (/^en/i.test(v.lang) ? 2 : 0) + (/Google UK English Male|Daniel|Arthur|Ryan|Thomas|Oliver/i.test(v.name) ? 3 : 0) - (v.localService === false && !/natural|online/i.test(v.name) ? 0 : 0);
      return voices.filter(v => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a))[0] || null;
    }
    // say(): pace notes (chain) and fixed phrases (sysToken) play from the open-model voice bank;
    // anything the bank can't voice (drive names...) falls back to the device voice.
    // opts: kind 'hazard' (goes first, may cut off an ordinary line), key (never twice in a row), atM (route metres: dropped once passed).
    // review recordings (.github/workflows/app-review.yml, debug builds only): every line said goes to the system log, a
    // transcript to read beside the video, which has no sound
    function saidLog(text) { if (window.APEX_REVIEW) { try { window.webkit.messageHandlers.apex.postMessage({ cmd: 'said', text: String(text) }); } catch (_) {} } }
    function say(text, force, chain = null, sysToken = null, opts = {}) {
      // a road hazard (not a turn or a crest, which share the urgent speech lane) also alerts on the car's screen
      if (text && opts.alert && driveActive) carPost({ kind: 'hazard', title: text });
      if (text) state.lastSaid = String(text);
      // Kit's box (Tapedeck, U-113): Kit's own aside from the pre-call of the call it follows, never the call again (the strip
      // has it); a call with no aside leaves the box empty. kitFor: the strip's notes it is about, so it clears (U-100).
      if (text && 'aside' in opts) { state.kitLine = opts.aside ? opts.aside.text.replace(/\.$/, '').toUpperCase().slice(0, 64) : null; state.kitFor = opts.aside ? opts.kitFor || null : null; }
      if (!text || (!state.toggles.voice && !force)) return;
      saidLog(text);
      if (force) { speech.queue.clear(); speech.followUp = null; stopSpeaking(); opts = { duck: true, ...opts }; }   // a line you asked for is heard
      // a fixed line ("Rerouting", "Bump ahead") is in every voice pack (web/voice_lines.js): the pack says it, not the phone
      if (!chain && !sysToken && !opts.tokens && window.ApexVoiceLines) { const t = ApexVoiceLines.forText(text); if (t) opts = { ...opts, tokens: t }; }
      speech.queue.push({ text, chain, sysToken, ...opts }, performance.now());
      if (!force) preemptForHazard();
      pumpSpeech(force);
    }
    // A hazard said ahead of whatever ordinary lines are waiting (convoy hazard calls far ahead).
    function sayNext(text, key) { say(text, false, null, null, { kind: 'hazard', key }); }
    // Panel round 2 LA-4: a change of notes mode is a chime ('wake' rising, 'sleep' falling, theme_sounds.js MODE), never
    // the mode's name. It waits for the voice to be free and plays before the next line, or alone if none waits.
    function chime(kind) {
      if (!state.toggles.voice) return;
      speech.chime = kind;
      if (!speech.busy) pumpSpeech();
    }
    const queueCursor = () => (track && state.cursorIdx >= 0 ? state.cursorM : null);
    // A hazard waiting while an ordinary line plays: cut the line off. A model-voice clip is short and finishes; the hazard is next.
    function preemptForHazard() {
      if (!speech.busy || !ApexSpeechQueue.preempts(speech.current, speech.queue.items[0])) return;
      if (speech.via === 'native') { clearTimeout(speech.nativeTimer); speech.busy = false; speech.interrupt = true; }
      else if (speech.via === 'web' && 'speechSynthesis' in window) speechSynthesis.cancel();   // onend pumps the hazard
    }
    // A tap as a call starts (IDEAS U-09): the app's Taptic Engine, or a short buzz where the browser offers one. Off in Settings.
    function haptic(kind) {
      if (!state.toggles.haptics) return;
      const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex;
      if (native) { try { native.postMessage({ cmd: 'haptic', kind }); } catch (_) {} return; }
      try { if (navigator.vibrate) navigator.vibrate(kind === 'hazard' ? [60, 60, 60] : 25); } catch (_) {}
    }
    function stopSpeaking() {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      if (speech.via === 'native') { clearTimeout(speech.nativeTimer); speech.busy = false; speech.interrupt = true; }
    }
    // In the app the shell owns the audio route (car stereo, CarPlay audio, Bluetooth): tell it while a web voice clip plays.
    // duck (IDEAS V-08, ApexSpeechQueue.ducks): lower the music for this line, or play over it.
    // Starting one resolves with the shell's prompt style (CarPlay Developer Guide, Voice prompts): 'none' during a call or
    // Siri, 'short' when the shell played a tone instead, 'normal' to speak. A browser, or a shell that doesn't answer, speaks.
    let promptStyleWaiter = null;
    function voiceBracket(on, duck = true) {
      const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex;
      if (!native) return Promise.resolve('normal');
      if (!on) { try { native.postMessage('voiceEnd'); } catch (_) {} return Promise.resolve('normal'); }
      return new Promise((resolve) => {
        const t = setTimeout(() => { promptStyleWaiter = null; resolve('normal'); }, 250);
        promptStyleWaiter = (style) => { clearTimeout(t); promptStyleWaiter = null; resolve(style); };
        try { native.postMessage({ cmd: 'voiceBegin', duck }); } catch (_) { promptStyleWaiter('normal'); }
      });
    }
    async function pumpSpeech() {
      if (speech.busy) return;
      // U-113: the aside of the call just said, if nothing else waits (it never pushes a line out) and it can still end
      // before the corner (dueByM); dropped otherwise
      const follow = speech.followUp; speech.followUp = null;
      if (follow && !speech.queue.size && state.toggles.voice) {
        speech.queue.push({ text: follow.text, tokens: [follow.token], kind: 'ordinary', dueByM: follow.dueByM, maxAgeMs: 3000, duck: true, key: 'aside', repeatMs: 0 }, performance.now());
      }
      let item = speech.queue.take(performance.now(), queueCursor());
      const chimed = speech.chime; speech.chime = null;   // LA-4: a mode chime waiting for the voice to be free
      if (!item) {
        speech.current = null; speech.via = null;
        if (chimed) saidLog(`[chime: ${chimed}]`);   // review recordings: the earcon in the transcript, where the line used to be
        if (chimed && window.ApexThemeSounds && window.ApexVoice) { try { ApexThemeSounds.play(ApexVoice.unlock(), ApexThemeSounds.recipe(state.theme, chimed, Themes.get(state.theme).sounds)); } catch (_) {} }
        return;
      }
      // MA-3: advice rides in its call; a call that waited in the queue past the advice's last start says the call alone
      const advice = item.aside && item.aside.kind === 'advice' ? item.aside : null;
      if (advice && typeof advice.dueByM === 'number' && queueCursor() != null && queueCursor() > advice.dueByM) item = { ...item, text: advice.bare || item.text, aside: null };
      speech.followUp = item.aside && item.aside.kind !== 'advice' ? item.aside : null;   // colour: its own clip, after the call
      if (item.key === 'aside') { state.lastSaid = item.text; saidLog(item.text); }
      if (item.kind === 'hazard' || item.chain || item.haptic) haptic(item.kind === 'hazard' ? 'hazard' : 'note');
      speech.busy = true; speech.current = item; speech.via = 'model';
      // the theme's pre-call sound before a call, and the one hazard two-tone (the same in every theme) before a hazard;
      // LA-4: the rising chime before the first call after the notes wake, the falling one before the quiet line
      const cue = item.kind === 'hazard' ? 'hazard' : item.cue || chimed || (item.chain ? 'pre' : null);
      if (cue === 'wake' || cue === 'sleep') saidLog(`[chime: ${cue}]`);
      if (cue && window.ApexThemeSounds && window.ApexVoice) {
        try { const len = ApexThemeSounds.play(ApexVoice.unlock(), ApexThemeSounds.recipe(state.theme, cue, Themes.get(state.theme).sounds)); await new Promise(r => setTimeout(r, len * 1000 + 40)); } catch (_) {}
      }
      const duck = ApexSpeechQueue.ducks(item, isSpirited());
      let played = false;
      try {
        if (state.voiceId !== 'device' && window.ApexVoice) {
          await ApexVoice.load(state.voiceId);
          const own = item.tokens || (item.chain ? ApexVoice.tokensFor(item.chain, ApexVoice.bank.style) : item.sysToken ? [item.sysToken] : null);
          // MA-3: the advice's clip in the same breath as the call's (rally words; plain words are spoken whole)
          const tokens = own && item.chain && item.aside && item.aside.kind === 'advice' ? [...own, item.aside.token] : own;
          const promptStyle = await voiceBracket(true, duck);
          if (promptStyle !== 'normal') { voiceBracket(false); speech.busy = false; speech.followUp = null; pumpSpeech(); return; }   // silent or a tone: skip the words
          try {
            // A call the bank can only voice by joining clips plays as one whole render when the
            // route-load prefetch has it; the join is the audible seam we are avoiding.
            if (tokens && state.liveVoice && (item.named || ApexVoice.joins(tokens) > 0)) played = await ApexVoice.playWhole(item.named ? item.text : spokenTextFor(item.text, ApexVoice.bank.style));
            if (!played && tokens) played = await ApexVoice.play(tokens);
            // Not in the bank (drive names, route summaries): synthesise live with the same model.
            if (!played && state.liveVoice) played = await ApexVoice.speakLive(spokenTextFor(item.text, ApexVoice.bank.style));
          } finally { voiceBracket(false); }
        }
      } catch (_) { /* fall back to the device voice */ }
      if (played) { speech.busy = false; pumpSpeech(); return; }
      deviceSpeak(spokenText(item.text), duck);
      if (speech.queue.hazardWaiting(performance.now(), queueCursor())) preemptForHazard();   // a hazard arrived while the model voice tried
    }
    function deviceSpeak(spoken, duck = true) {
      const style = state.voiceStyle;
      const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex;
      if (native) {
        // One line at a time, so a hazard can still go ahead of the lines behind it; a hazard cutting in interrupts at a word.
        const interrupt = !!speech.interrupt; speech.interrupt = false;
        try { native.postMessage({ cmd: 'speak', text: spoken, force: interrupt, style, duck }); } catch (_) {}
        speech.talkingUntil = (interrupt ? performance.now() : Math.max(performance.now(), speech.talkingUntil)) + 600 + spoken.length * 70;   // ~14 characters a second
        speech.via = 'native';
        clearTimeout(speech.nativeTimer);
        speech.nativeTimer = setTimeout(() => { speech.busy = false; pumpSpeech(); }, Math.max(0, speech.talkingUntil - performance.now()));
        return;
      }
      if (!('speechSynthesis' in window)) { speech.busy = false; return; }
      speech.via = 'web';
      const u = new SpeechSynthesisUtterance(spoken);
      const v = pickVoice(state.voiceStyle);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = 1.12; u.pitch = 1.0;
      u.onend = u.onerror = () => { speech.busy = false; pumpSpeech(); };
      speechSynthesis.speak(u);
    }

    function subFor(e) {
      if (e.type === 'corner') return `R ${Math.round(e.radius_m)} m · ${Math.round(ApexUnits.speed(e.apex_mph / 2.2369362921))} ${ApexUnits.speedU()}`;
      if (e.type === 'alpr') return 'Camera';
      return ApexRecording.seenLabel(e);
    }
    // U-93: the gap to the next note in the driver's units ("400 ft to next" on a miles drive), never metres to a driver in miles
    const linkLabel = (e) => { if (!e.link) return ''; if (e.link === 'into' || e.link === 'and') return ` · ${e.link.toUpperCase()}`;
      const d = ApexUnits.short(Number(e.link)); return Number.isFinite(Number(e.link)) ? ` · ${d.n} ${d.u.toLowerCase()} to next` : ''; };

    // Co-driver reading: the note, then "into"/"and" + the next note when it follows at once,
    // otherwise the distance to it ("Left 4 minus long, 150"). Chained notes are not called twice.
    // run: the run of corners being read (careRun below), when the call is about to be said: its "care" is said once.
    // opt.vMps: the car's speed. Panel round 2 MA-2: the distance to the next note is said (and in plain words the next
    // corner named) only within note_timing.js chainReachM (150 m, or 6 s at speed); past it the call ends at its corner.
    // opt.advice: MA-3, the pack's advice, said as the call's last sentence; `bare` is the call without it.
    function chainedCall(e, ev, spirited, run = null, opt = {}) {
      let cur = e;
      const raw = [e];
      for (let hops = 0; hops < 2 && (cur.link === 'into' || cur.link === 'and'); hops++) {
        const next = ev[ev.indexOf(cur) + 1];
        if (!next || (next.type === 'corner' && !spirited) || noteM(next) > turnHold.m) break;   // never chained past a junction not yet called
        state.spoken.add(`${track.id}:${next.type}:${next.index}`);
        raw.push(next);
        cur = next;
      }
      // REVIEW4 §4: "careful" after every tight corner stops meaning anything by the third; a co-driver says it once a stage.
      // The lightest caution (rally "care", plain "careful") is said once per run of corners; the stronger ones ("caution",
      // "slow down" and up) are about that corner and always said. The strip still marks every one.
      const care = (n) => (run ? run.spend(n) : n);   // note_timing.js createCareRun
      const chain = raw.map(care);
      const reach = ApexNoteTiming.chainReachM(opt.vMps);
      const linked = !!cur.link && cur.link !== 'into' && cur.link !== 'and', carried = linked && Number(cur.link) <= reach;   // MA-2
      let text = chain.map((n, i) => (i ? ` ${chain[i - 1].link} ` : '') + n.call).join('');
      // The last note's link is "into"/"and" only if the chain was cut short; don't voice a dangling link, nor one past reach.
      const voiced = chain.map((n, i) => (i === chain.length - 1 && (n.link === 'into' || n.link === 'and' || (linked && !carried))) ? { ...n, link: null } : n);
      // Your own recce call in the chain (recce.js, V-09): spoken whole as you wrote it, in either words mode (the bank's
      // clips and plain words are built from the map's corner, not your text).
      const keys = raw.map((n) => `${n.type}:${n.index}:${n.dist_m}`);   // the strip's keys of the notes it calls (Kit, U-100)
      if (chain.some((n) => n.recce)) return { text: linked ? `${text}, ${cur.link}` : text, chain: null, keys };
      if (carried) text += `, ${cur.link}`;
      // Plain words: spoken whole (the voice bank's clips are rally words), from the same notes.
      // U-109: a distance link names the corner it leads to ("then easy right in 400 feet"); none past a junction not yet
      // called. MA-2: when the named corner carries "careful", that is the run's one (its own call then comes without it).
      const after = carried ? ev[ev.indexOf(cur) + 1] : null;
      const next = after && !(noteM(after) > turnHold.m) && state.noteWords === 'plain' ? care(after) : null;   // rally names no next corner
      const card = !!(window.ApexVoiceLines && ApexVoiceLines.PACKS[state.voiceId] && ApexVoiceLines.PACKS[state.voiceId].card);   // Hale reads a card (U-113)
      if (state.noteWords === 'plain') {   // in the driver's units (U-93)
        const bare = ApexPlainNotes.plainChain(voiced, ApexUnits, { next, card, reachM: reach });
        return { text: opt.advice ? ApexPlainNotes.plainChain(voiced, ApexUnits, { next, card, reachM: reach, advice: opt.advice }) : bare, bare, chain: null, keys, voiced };
      }
      return { text: opt.advice ? ApexNoteTiming.withAdvice(text, opt.advice) : text, bare: text, chain: voiced, keys, voiced };
    }
    // The run of corners being read (note_timing.js createCareRun, REVIEW4 §4): its "care" is said once.
    const careRun = ApexNoteTiming.createCareRun();
    // REVIEW5 U-113: the pack's aside for a call (voice_lines.js createAsides: rare, never after a warning or in a run), only
    // from a clip the loaded bank holds (a bank rendered before the asides says none). Panel round 2 MA-3: planned WITH the
    // call (note_timing.js asideWindow), which then starts early enough to carry it: advice inside the call, colour as its
    // own clip straight after; both end before the braking point and at least 4 s from the corner, and colour before the
    // next note's call is due. One that can't is not picked (dropped, never deferred) and the call keeps its own lead.
    // `call` is chainedCall's (its text, voiced chain and keys), dM the metres from the car to the corner's entry.
    const asides = window.ApexVoiceLines ? ApexVoiceLines.createAsides() : null;
    function packAside(call, e, ev, dM, vMps, apexMps = null, reactionS = undefined) {
      const bank = window.ApexVoice && ApexVoice.bank;
      if (!asides || !call.voiced || !bank || bank.id !== state.voiceId) return null;
      const atM = noteM(e), after = ev[ev.indexOf(e) + call.keys.length];
      const nextCallM = after ? noteM(after) - ApexNoteTiming.leadM({ vMps, apexMps: apexMpsOf(after), text: after.call, reactionS }) : Infinity;
      let win = null;
      const fits = ({ text, kind }) => {
        win = ApexNoteTiming.asideWindow({ dM, atM, vMps, apexMps, callText: call.text, text, kind, reactionS });
        const endsM = atM - ApexNoteTiming.asideMarginM({ vMps, apexMps, reactionS });
        return win.fits && dM <= win.leadM && (kind === 'advice' || endsM <= nextCallM);
      };
      const a = asides.pick(state.voiceId, call.voiced, performance.now(), (t) => !!bank.tokens[t], fits);
      return a ? { ...a, dueByM: win.dueByM } : null;
    }
    // The next turn not yet taken (web/directions.js createProgress), one for the voice and the car's card, so both are about
    // the same turn and a taken one never comes back. turnHold.m: the first junction ahead whose call at the turn is not yet
    // said; no note past it is read until it is (the owner's drive, 2026-10-30: a far corner's call landed among the exit's).
    const turnProgress = ApexDirections.createProgress(), turnHold = { m: Infinity };

    // Where a note is due: a corner's entry (turn-in), not its apex, so the call and the countdown come before you turn
    // (owner 2026-10-28: "called out in reference to the apex rather than the entry"). Hazards are a point: entry = apex.
    // Your reaction to a call, learned from when you start braking after one (note_timing.js), kept on this phone.
    const REACT_KEY = 'apex.reactionS';
    const reaction = ApexNoteTiming.createReactionLearner((() => { try { return Number(localStorage.getItem(REACT_KEY)) || undefined; } catch (_) { return undefined; } })());
    function feedReaction(frame) {
      const learned = reaction.frame(performance.now(), frame.lon_g);
      if (learned != null) { try { localStorage.setItem(REACT_KEY, learned.toFixed(2)); } catch (_) {} }
    }
    const noteM = (e) => (Number.isFinite(e.start_m) && e.start_m <= e.dist_m ? e.start_m : e.dist_m);
    const apexMpsOf = (e) => (e.type === 'corner' && Number.isFinite(e.apex_mph) ? e.apex_mph / 2.2369362921 : e.type === 'mark' && e.kind === 'stop' ? 0 : null);   // a stop sign: braking to a stop
    let lastNotes = [];
    // U-58: Auto says when it goes quiet and when the notes come back (ApexNoteTiming.createWakeVoice: once each way, never
    // within two minutes of the last, silent on a drive's first reading). The drive's first note is called whatever the
    // mode's gate says: state.firstNoteDue from Start until a track is there to choose it, then state.firstNoteKey.
    const wakeVoice = ApexNoteTiming.createWakeVoice();
    // U-86: the strip. A lead note driven up to and then waited at, 0 ft under 2 m/s for PASSED_STOP_MS, is behind you
    // (a ramp, a junction queue) and drops out; a new lead shows once it has held LEAD_HOLD_MS, so one GPS jump can't flick
    // the strip to Clear and back. U-74: noteNearUntil, while the lead note is within its lead, plain toasts wait (heldToast).
    const LEAD_HOLD_MS = 600, PASSED_STOP_MS = 3000, OPENER_WAIT_MS = 4000;   // OPENER_WAIT_MS: DA-3, how long the opener waits for the road's name
    const strip = { track: null, passed: new Set(), approached: null, stall: null, stallAt: 0, shown: null, pending: null, pendingAt: 0 };
    // AM-2 (panel round 2): the strip said for VoiceOver, one line kept last in #notes (the strip's own boxes are hidden from
    // it): the calls in the grammar's words with their distances (say.js strip). Its words change only when the lead does or
    // its distance crosses a band, and it is never live, so it is read when swiped to and never talks over the co-driver.
    const bookSay = { el: null, text: null };
    function roadBookSaid(notes) {
      const box = $('notes');
      if (!window.ApexSay || !box) return;
      if (!bookSay.el) { bookSay.el = document.createElement('p'); bookSay.el.className = 'sr-only'; bookSay.el.id = 'notesSaid'; }
      if (bookSay.el.parentNode !== box || box.lastElementChild !== bookSay.el) {   // the strip was built anew: its boxes are pictures
        for (const c of box.children) if (c !== bookSay.el) c.setAttribute('aria-hidden', 'true');
        box.append(bookSay.el);
      }
      const t = ApexSay.strip(notes);
      if (t !== bookSay.text) { bookSay.text = t; bookSay.el.textContent = t; }
    }
    let heldToast = null;
    // U-67: the road under the car, from the map's own road names (ApexRoadNames, the source the saved drive is named by in
    // leaveDrive), read at most every 2 s; null while the map has no named road there (the binnacle shows "--").
    const roadNow = { at: -Infinity, name: null, hold: null };   // hold: the last name seen, held through a junction (U-137)
    function roadUnder(lat, lon) {
      const now = performance.now();
      if (now - roadNow.at < 2000) return roadNow.name;
      roadNow.at = now;
      let feats = [];
      try { feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name' }); } catch (_) { /* style not loaded */ }
      const seen = window.ApexRoadNames && Number.isFinite(lat) && Number.isFinite(lon) ? ApexRoadNames.nearestRoadName(feats, lat, lon) : null;
      // U-137: held 5 s when the tiles give none, and through a junction the app knows it is in (a router turn, or a corner
      // the strip calls "like a junction"), so the binnacle never says "Road: --" mid-junction
      const cm = state.cursorM, inJunction = !!track && Number.isFinite(cm) && ((track.kind === 'route' && window.ApexDirections && ApexDirections.atJunction(track.steps, cm))
        || (Array.isArray(track.events) && track.events.some((e) => e.type === 'corner' && e.shape === 'square' && cm >= e.start_m - 20 && cm <= e.end_m + 20)));
      const h = window.ApexRoadNames ? ApexRoadNames.holdRoadName(roadNow.hold, seen, now, inJunction) : { name: seen, hold: null };
      roadNow.name = h.name; roadNow.hold = h.hold;
      return roadNow.name;
    }
    // The strip's line when no note is up. Planning: the route and the mode. In a drive or a replay, quiet (U-67): the road
    // under you and how far to the corner that brings the notes back ("Quiet · I-275 · next corner 13 mi"). Off a planned
    // route, the rerouter's words; a drive without one (the road ahead, or nothing yet) never says them (U-72).
    // compact: the same line for a strip it would not fit in two rows of (U-100): the road as its sign shortens it, "corner
    // 0.7 mi" for "next corner 0.7 mi"; the instruments pick it only when the full line needs a third row.
    function quietLine(spirited, offRoute, driving, next, compact = false) {
      // U-90: wrong way on a road is still that road (the strip said "Wrong way" with no road for seven minutes)
      const offWords = offRoute && track && track.kind === 'route' ? offRouteText() : null;
      if (offWords) return [offWords, /^Wrong way/.test(offWords) ? roadNow.name : null].filter(Boolean).join(' · ');
      if (replayEnded && !driveActive) return state.mode === 'sim' ? 'That\'s the route' : 'That\'s the drive';   // U-110
      if (replayWaiting && !driveActive && track) return track.name || 'Replay';                                     // U-128
      if (!driving) return track ? `${track.name} · ${spirited ? 'Full notes' : 'Quiet notes'}` : 'Plan a route for notes';
      if (!track && !driveActive) return 'No route planned';
      if (spirited) return `${track && !offRoute && track.kind !== 'horizon' ? track.name : 'The road ahead'} · Full notes`;
      const named = roadNow.name && compact && window.ApexRoadNames ? ApexRoadNames.shortRoadName(roadNow.name) : roadNow.name;
      const road = named || (track && track.kind === 'horizon' && !offRoute ? 'The road ahead' : null);
      const ahead = next ? Math.max(0, next.m - state.cursorM) : null, d = ahead != null ? distLabel(ahead) : null;
      const far = d && (d.u === 'MI' || d.u === 'KM') ? ApexUnits.long(ahead, 1, true) : d ? `${d.n} ${d.u.toLowerCase()}` : null;
      return ['Quiet', road, far ? `${compact ? 'corner' : 'next corner'} ${far}` : null].filter(Boolean).join(' · ');   // what Quiet calls is the Notes switch's to say, not the strip's
    }
    function updateNotes(vMps, live) {
      // Driving somewhere that is not on the loaded route: its calls (and its stale trip distance) must never be read out as if they were this road.
      const offRoute = live && state.cursorIdx < 0;
      const ev = offRoute ? [] : allEvents().filter(e => e.dist_m >= state.cursorM - 5 && (e.type !== 'alpr' || state.toggles.lpr)).sort((a, b) => noteM(a) - noteM(b));
      const steps = !offRoute && track && track.kind === 'route' ? track.steps : null;
      const pend = steps ? turnProgress.at(steps, state.cursorM, track.id) : -1;
      turnHold.m = Infinity;
      for (let j = Math.max(0, pend); pend >= 0 && j < steps.length; j++) {
        if (ApexDirections.phrase(steps[j]) && !state.spoken.has(`${track.id}:dir:${j}:now`)) { turnHold.m = steps[j].m; break; }
      }
      const moving = !!(state.playing || live) && vMps != null, now = performance.now();
      const reactS = reaction.reactionS;
      // U-58: Auto reads the road ahead. A corner within two leads (at least 800 m) that is tight or needs braking keeps
      // the notes awake, the same 30 s hold as the g test; a junction's corner is called as the direction, so it doesn't count.
      const corners = moving ? ev.filter(e => e.type === 'corner' && !ApexDirections.atJunction(steps, noteM(e)))
        .map(e => ({ m: noteM(e), severity: e.severity, apexMps: apexMpsOf(e), text: e.call, e })) : [];
      // Panel round 2 MA-1: awake, Auto stays awake while a waking corner is within its wider sleep window or any corner is
      // within its call lead (note_timing.js keepsAwake): it never goes quiet with a corner on the page.
      const wakeAt = { cursorM: state.cursorM, vMps, reactionS: reactS };
      if (state.notesMode === 'auto' && (ApexNoteTiming.wakeCorner(corners, wakeAt) || (isSpirited() && ApexNoteTiming.keepsAwake(corners, wakeAt)))) state.spiritedAt = now;
      const spirited = isSpirited();
      const quietSaid = () => ApexNoteTiming.quietSpan(ApexNoteTiming.quietM(corners, wakeAt), ApexUnits);   // "two miles", or null
      if (moving && state.notesMode === 'auto') {
        // LA-4: the change is a chime, not the mode's name. Waking: the rising chime goes on the first call (MA-1: the wake
        // line IS the first call; none before it goes quiet again, nothing). Quiet: the falling chime, then how far the quiet lasts in
        // the pack's words ("Quiet for two miles."), the one thing a chime can't say; under half a mile or unknown, the chime.
        const t = wakeVoice.update(spirited, now);
        if (t === 'on') state.wakeCue = true;
        if (t === 'off') {
          careRun.reset();   // the run of corners is over: the next one's "care" is said (§4)
          state.wakeCue = false;
          const line = window.ApexVoiceLines ? ApexVoiceLines.quietLine(state.voiceId, quietSaid()) : null;
          if (line) say(line, false, null, null, { key: 'wake:off', cue: 'sleep', duck: true }); else chime('sleep');
        }
      } else wakeVoice.reset();
      // U-58: a drive's first note is its first corner, when one is within the wake window as the drive begins (a drive that
      // starts on a motorway starts quiet, and says so in the strip). Quiet mode is the driver's choice: no first note there.
      if (state.firstNoteDue && live && driveActive && track && vMps != null) {
        const c = corners[0];
        state.firstNoteDue = false;
        state.firstNoteKey = c && state.notesMode !== 'quiet' && c.m - state.cursorM <= ApexNoteTiming.wakeWindowM({ vMps, apexMps: c.apexMps, text: c.text, reactionS: reactS })
          ? `${track.id}:corner:${c.e.index}` : null;
      }
      const firstKey = track && state.firstNoteKey && state.firstNoteKey.startsWith(`${track.id}:`) ? state.firstNoteKey : null;
      const isFirst = (e) => !!firstKey && `${track.id}:${e.type}:${e.index}` === firstKey;
      const shown = ev.filter(e => spirited || noteworthyInCruise(e) || e.type !== 'corner' || isFirst(e)).filter(e => noteM(e) - state.cursorM <= 3000)
        .filter(e => !(e.type === 'corner' && ApexDirections.atJunction(steps, noteM(e)))).slice(0, 3);   // a junction shows once, as the direction
      const notes = shown.map(e => {
        const d = distLabel(Math.max(0, noteM(e) - state.cursorM));   // 0 once you're in the corner
        return { key: `${e.type}:${e.index}:${e.dist_m}`, type: e.type, code: e.code, call: state.noteWords === 'plain' && !e.recce ? ApexPlainNotes.plainCall(e) : e.call, sub: subFor(e) + linkLabel(e), dist: d.n, unit: d.u, distM: Math.max(0, noteM(e) - state.cursorM),
                 dir: e.dir, severity: e.severity, turnRad: e.turn_rad, mods: e.mods || [], recce: !!e.recce, apexMps: apexMpsOf(e) };
      });
      // The route's junctions in the same strip, in road order with the notes (IDEAS V-04).
      (steps || []).forEach((st, i) => {
        const ahead = st.m - state.cursorM, n = ahead >= -5 && ahead <= 3000 ? ApexDirections.stripNote(st) : null;
        if (!n) return;
        const d = distLabel(Math.max(0, ahead));
        notes.push({ key: `turn:${i}`, type: 'turn', code: n.code, call: n.call, sub: '', dist: d.n, unit: d.u, distM: Math.max(0, ahead), dir: n.dir, angle: n.angle, mods: [],
                     lanes: n.lanes && ahead <= 1600 ? ApexLanes.lanes(n.lanes) : null });   // the lanes from a mile out
      });
      notes.sort((a, b) => a.distM - b.distM);
      if (strip.track !== track) { strip.track = track; strip.passed.clear(); strip.approached = null; strip.stall = null; strip.shown = null; strip.pending = null; }
      for (let i = notes.length - 1; i >= 0; i--) if (strip.passed.has(notes[i].key)) notes.splice(i, 1);
      notes.splice(3);
      // U-86: a note the car drove up to and now waits at (0 ft, under 2 m/s, 3 s) is passed; the strip moves on. A corner
      // under the car as the drive starts was never driven up to, so it stays until it is driven.
      const head = notes[0];
      if (moving && head && head.distM > 0) strip.approached = head.key;
      if (moving && head && head.type !== 'turn' && head.distM === 0 && vMps < 2 && strip.approached === head.key) {   // a turn stays until taken
        if (strip.stall !== head.key) { strip.stall = head.key; strip.stallAt = now; }
        else if (now - strip.stallAt > PASSED_STOP_MS) { strip.passed.add(head.key); notes.shift(); strip.stall = null; }
      } else strip.stall = null;
      const nextUp = moving && state.notesMode === 'auto' && !spirited ? ApexNoteTiming.nextWake(corners, { cursorM: state.cursorM, vMps }) : null;
      notes.quietText = quietLine(spirited, offRoute, !!(state.playing || live), nextUp);
      notes.quietShort = quietLine(spirited, offRoute, !!(state.playing || live), nextUp, true);   // U-100
      // U-86: a new lead note shows once it has held LEAD_HOLD_MS; until then the strip keeps the one it shows.
      let showN = notes;
      const leadKey = notes[0] ? notes[0].key : null, shownKey = strip.shown && strip.shown[0] ? strip.shown[0].key : null;
      if (moving && strip.shown && leadKey !== shownKey) {
        if (strip.pending !== leadKey) { strip.pending = leadKey; strip.pendingAt = now; }
        if (now - strip.pendingAt < LEAD_HOLD_MS) showN = strip.shown;
      }
      if (showN === notes) { strip.shown = notes; strip.pending = null; }
      // U-100: Kit's line is the last thing said; once the strip's lead moves to a note that line was not about, it is stale
      // ("KIT SAYS: TIGHT RIGHT, CAREFUL" for 20 s under VERY SHARP…), so Kit falls quiet until he says the next one.
      const headKey = showN[0] ? showN[0].key : null;
      if (headKey !== state.kitHead) {
        if (state.kitHead !== undefined && state.kitLine && !(state.kitFor && state.kitFor.includes(headKey))) { state.kitLine = null; state.kitFor = null; }
        state.kitHead = headKey;
      }
      showN.words = state.noteWords;                                    // M-3: the next cells in the head's notation
      Inst.renderNotes($('notes'), look.theme, showN);
      roadBookSaid(showN);
      state.crestAhead = !!(showN[0] && showN[0].type === 'crest' && showN[0].distM < 150);   // Kit sits up for it
      lastNotes = showN;
      if (live) pushActivity(notes);
      if (live) carGuide();
      // U-74: nothing lands on the map while the lead note is within its lead distance; a waiting toast shows after it.
      const up = showN[0];
      if (moving && driveActive && up && up.distM <= ApexNoteTiming.leadM({ vMps, apexMps: up.apexMps, text: up.call, reactionS: reactS })) state.noteNearUntil = now + 1500;
      if (heldToast && !(now < (state.noteNearUntil || 0))) { const h = heldToast; heldToast = null; if (now - h.at < 30000) toast(h.msg); }

      if (!moving) return;
      // Panel round 2 DA-3: a drive's first words name the road under the car, then the notes' state in the pack's words
      // ("Dry Ridge Road. Full notes.", "Dry Ridge Road. Quiet for two miles."). Said once the map names the road, within
      // OPENER_WAIT_MS of Start, and always ahead of the first call (force); with no road known nothing is said (the
      // strip and the chime carry the mode, and the first call is the first line).
      const openNotes = (force) => {
        if (!state.openerDue || !live || !driveActive) return;
        const road = roadNow.name;
        if (!road && !force && now - (state.openerAt || 0) < OPENER_WAIT_MS) return;
        state.openerDue = false;
        const span = !spirited && state.notesMode === 'auto' ? quietSaid() : null;
        const line = road && window.ApexVoiceLines ? ApexVoiceLines.openerLine(state.voiceId, { road, awake: spirited, span }) : null;
        if (line) say(line, false, null, null, { key: 'opener', duck: true });
      };
      openNotes(false);
      // How far ahead to read a note (note_timing.js, IDEAS V-01): time to say it, your reaction (learned), and braking from
      // your speed to the corner's. `lead` is the point-hazard version (no braking), also used by the quiet-window checks below.
      const lead = ApexNoteTiming.leadM({ vMps, text: 'Bump ahead', reactionS: reactS });
      const stopped = vMps < 2;
      for (const e of ev) {
        const d = noteM(e) - state.cursorM;
        const key = `${track.id}:${e.type}:${e.index}`, first = key === firstKey;
        // the drive's first note may lie past the usual reach while the car waits at the start
        if (d > ApexNoteTiming.MAX_M && !first) { if (firstKey && !state.spoken.has(firstKey) && d < 2 * ApexNoteTiming.MAX_M) continue; break; }
        // U-58: the first note of a drive is read before the car moves, even the corner under it
        if (state.spoken.has(key) || (d < 10 && !(first && stopped))) continue;
        if (e.type === 'corner' && ApexDirections.atJunction(track.steps, noteM(e))) { state.spoken.add(key); continue; }   // the direction calls it
        // past a junction whose call at the turn is not yet said: it waits (one maneuver at a time, the junction first), and
        // is read after that call, queued behind it, or skipped by U-96 below if that leaves it too late
        if (noteM(e) > turnHold.m) continue;
        // U-96: a corner already too close to say with a beat to act (the first call after a wake, a mode switch or an
        // off-route spell, a lead eaten by a slow line) is the driver's now: skipped, never read in the corner. Decided
        // before the chain is built, so the next corner keeps its own call.
        const own = state.noteWords === 'plain' && !e.recce ? ApexPlainNotes.plainCall(e) : e.call;
        const lastM = e.type === 'corner' ? ApexNoteTiming.lastCallM({ vMps, text: own }) : 0;
        if (e.type === 'corner' && !(first && stopped) && d < lastM) { state.spoken.add(key); continue; }
        let call = chainedCall(e, ev, spirited || first, null, { vMps });
        const apexMps = apexMpsOf(e);
        const startCall = first && stopped && d <= ApexNoteTiming.wakeWindowM({ vMps, apexMps, text: call.text, reactionS: reactS });
        const voiced = first || (e.type === 'corner' ? spirited : spirited || noteworthyInCruise(e));
        // U-113 / MA-3: the pack's aside, now and then, planned with its call: when one fits, the call starts at the aside's
        // lead (earlier than its own) so both end before the braking; advice is said in the call, colour straight after it.
        // Kit's box shows it from the pre-call.
        const aside = voiced && !startCall ? packAside(call, e, ev, d, vMps, apexMps, reactS) : null;
        if (!startCall && !aside && d > ApexNoteTiming.leadM({ vMps, apexMps, text: call.text, reactionS: reactS })) continue;
        state.spoken.add(key);
        if (!voiced) continue;
        // (a first note read at the start may be under the car already: it is not stale for that)
        // dueByM: a call that waits in the queue (behind a quiet line, a direction) is dropped once it would be late (U-96)
        const advice = aside && aside.kind === 'advice' ? aside.text : null;
        if (e.type === 'corner' && !e.recce) call = chainedCall(e, ev, spirited || first, careRun.at(noteM(e), track.id), { vMps, advice });   // "care" once a run (§4)
        else if (advice) call = chainedCall(e, ev, spirited || first, null, { vMps, advice });
        openNotes(true);   // DA-3: the drive's opener goes first
        // LA-4 / MA-1: the first corner call after the notes wake carries the rising chime
        const cue = e.type === 'corner' && state.wakeCue ? 'wake' : undefined;   // until the notes go quiet again
        if (cue) state.wakeCue = false;
        say(call.text, false, call.chain, null, { kind: e.type === 'corner' ? 'ordinary' : 'hazard', key, atM: noteM(e), duck: true, kitFor: call.keys,
          aside: aside ? { ...aside, bare: call.bare } : null, cue,
          ...(e.type === 'corner' && !startCall ? { dueByM: noteM(e) - lastM } : {}), ...(startCall ? { atM: null } : {}) });
        if (live) reaction.called(performance.now(), call.text, ApexNoteTiming.needsBrake(vMps, apexMps));
      }
      // Directions at junctions (IDEAS V-04), in any notes mode: the call at the turn goes ahead of corner notes.
      if (track && track.kind === 'route' && !offRoute) {
        for (const line of ApexDirections.due(track.steps, state.cursorM, vMps, state.spoken, track.id, pend)) {   // the next turn only
          state.spoken.add(line.key); health.bump('directions_said');
          say(line.text, false, null, null, { kind: line.now ? 'hazard' : 'ordinary', key: line.key, atM: line.atM, duck: true, tokens: line.tokens || undefined, named: true });
        }
      }
      // Roads you have driven: one technique tip per remembered corner, only with full notes on (never over a commute),
      // moving on a fresh heading, and only when it ends before any call is due: it starts MEMO_S of driving beyond the
      // call distance and never while a call is pending in that stretch or another voice may still be speaking.
      // A bump your own drives confirmed, on any road (no route needed), held to the same quiet-mode rule as route bumps,
      // unless a route bump that will be called lies within reach along the route or within SAME_SPOT_M of it (a hairpin can
      // put it close in a straight line but far along the road). It never pushes a queued call out, and may be said again
      // once HZ_REPEAT_MS has passed (the same road later, a lap), so the id is not kept in state.spoken.
      if (live && vMps >= 5 && performance.now() - state.liveAt < 2500 && speech.queue.size < 2) {
        const calledBumps = ev.filter(e => e.type === 'bump' && (spirited || noteworthyInCruise(e)));
        const now = performance.now(), recent = { has: (id) => now - (hazardSaid.get(id) ?? -Infinity) < HZ_REPEAT_MS };
        const pool = hazardMemory.filter(n => (spirited || n.severity_g >= 0.45)
          && !calledBumps.some(e => e.dist_m - state.cursorM < lead + 30
            || Math.hypot((track.lon[e.index] - n.lon) * 111320 * Math.cos(n.lat * Math.PI / 180), (track.lat[e.index] - n.lat) * 110540) < HZ_SAME_SPOT_M));
        const hz = ApexRoadMemory.upcoming(pool, state.live, 25, lead, recent);
        if (hz) { hazardSaid.set(hz.id, now); say(hz.text, false, null, null, { kind: 'hazard', key: `mem:${hz.id}`, repeatMs: HZ_REPEAT_MS, alert: true }); }
      }
      const reach = lead + vMps * MEMO_S;
      if (live && spirited && vMps >= 5 && performance.now() - state.liveAt < 2500 && !speech.busy && !speech.queue.size
          && performance.now() > speech.talkingUntil
          && !ev.some(e => noteM(e) - state.cursorM < reach && !state.spoken.has(`${track.id}:${e.type}:${e.index}`))) {
        // on a wet or icy road (noteWet) "brake later here", learnt on your dry passes, is not said: the grip isn't there
        const slickNow = !!(drive.wet && (drive.wet.state === 'wet' || drive.wet.state === 'ice'));
        const memo = ApexRoadMemory.upcoming(slickNow ? roadMemory.filter((n) => n.kind !== 'brake_later') : roadMemory, state.live, reach, reach + 200, state.spoken);
        if (memo) { state.spoken.add(memo.id); say(memo.text); }
      }
      // A break suggestion waits for the same quiet (any notes mode: tiredness matters on a commute too): a fresh fix, a free
      // voice, and no call that will be spoken (route call or a remembered bump) within the distance the line takes to say,
      // at the app's estimate of 600 ms + 70 ms a character, plus 2 s for a model voice to start. Dropped after 5 min unsaid;
      // the toast already showed it.
      // The brake heat call (brakeSay, noteBrakes) goes first through the same gate, with its own 60 s expiry.
      // So does a long descent on the planned route (brake_heat.js descentAhead, from its terrain), once, near its top.
      if (live && !offRoute && !brakeSay && track === plannedRoute && Array.isArray(track.descents) && window.ApexBrakeHeat) {
        const said = drive.descentSaid || (drive.descentSaid = new Set());
        const d = ApexBrakeHeat.descentAhead(track.descents, state.cursorM, said);
        if (d) { said.add(d.start_m); brakeSay = { text: ApexBrakeHeat.descentCall(d, ApexUnits.spokenShort), until: performance.now() + 60000 }; }
      }
      // A low sun the road turns into (sun_ahead.js): on the road being followed, live, once every 5 minutes at most, not under
      // a sky the place plate knows is overcast or wet. Its own slot after brake heat, kept 15 s (then the stretch is near).
      if (live && !offRoute && !sunSay && track && window.ApexSunAhead && window.ApexSun) {
        const pd = placeAsk.data || {}, word = window.ApexPlacePlate ? ApexPlacePlate.weather(pd) : null, nowS = performance.now() / 1000;
        if (!ApexSunAhead.hidden(word, pd.code) && ApexSunAhead.due(nowS, drive.sunAt ?? null) && ApexSunAhead.ahead(track, state.cursorM, new Date())) {
          drive.sunAt = nowS; sunSay = { text: ApexSunAhead.TEXT, until: performance.now() + 15000 };
        }
      }
      // A posted limit that drops ahead (limit_ahead.js): said once per drop, before the sign, when you're over the new one;
      // first through the quiet gate (a limit has a place: 8 s, then the sign is close and the line goes stale).
      if (live && !offRoute && !limitSay && track && track.limitMps && window.ApexLimitAhead && vMps != null) {
        const drop = ApexLimitAhead.next(track, state.cursorM), said = drive.limitSaid || (drive.limitSaid = new Set());
        const key = drop && `${track.id}:${Math.round(drop.atM)}`;
        if (drop && !said.has(key) && ApexLimitAhead.due(drop, state.cursorM, vMps)) {
          said.add(key);
          const text = ApexLimitAhead.text(drop.limitMps, ApexUnits.speed);
          if (text) limitSay = { text, until: performance.now() + 8000 };
        }
      }
      // The stage briefing (briefing.js): once, as a drive on a planned route gets going, what the road holds; not in Quiet
      // notes. 30 s to find a quiet moment, then the start is behind you and it is dropped.
      if (live && !offRoute && driveActive && !drive.briefed && track && track === plannedRoute && window.ApexBriefing && state.notesMode !== 'quiet') {
        drive.briefed = true;
        const text = ApexBriefing.line(track, state.cursorM, ApexUnits.spokenShort);
        if (text) briefSay = { text, until: performance.now() + 30000 };
      }
      // A twisty section after a long quiet stretch of the planned route (corners_ahead.js): said once, about 30 s out; not
      // in Quiet notes. Kept 15 s, then the corners are close and their own calls take over.
      if (live && !offRoute && !cornersSay && track && track === plannedRoute && window.ApexCornersAhead && state.notesMode !== 'quiet' && vMps != null) {
        if (track.sectionsFor !== track.events) { track.sectionsFor = track.events; track.sections = ApexCornersAhead.sections(track.events); }
        const said = drive.sectionsSaid || (drive.sectionsSaid = new Set()), sec = ApexCornersAhead.next(track.sections, state.cursorM, said);
        if (sec && ApexCornersAhead.due(sec, state.cursorM, vMps)) { said.add(sec.startM); cornersSay = { text: ApexCornersAhead.text(sec, state.cursorM, ApexUnits.spokenShort), until: performance.now() + 15000 }; }
      }
      if (cornersSay && (performance.now() > cornersSay.until || state.notesMode === 'quiet')) cornersSay = null;
      // The places along the planned route (along_ahead.js, from the route card's t.scenic): the last fuel before a long
      // stretch with none, in any notes mode; a viewpoint or waterfall at most every 5 minutes, not in Quiet notes.
      if (live && !offRoute && !alongSay && track && track === plannedRoute && Array.isArray(track.scenic) && window.ApexAlongAhead && vMps != null) {
        const said = drive.alongSaid || (drive.alongSaid = new Set()), nowS = performance.now() / 1000;
        const a = ApexAlongAhead.due(track, state.cursorM, vMps, { said, lastViewS: state.notesMode === 'quiet' ? nowS : drive.viewAt, nowS,
          electric: !!(routingCar() && routingCar().fuel === 'electric'), metric: ApexUnits.metric(), spoken: ApexUnits.spokenShort });
        if (a) { said.add(a.key); if (a.view) drive.viewAt = nowS; alongSay = { text: a.text, until: performance.now() + (a.view ? 10000 : 20000) }; }
      }
      if (alongSay && performance.now() > alongSay.until) alongSay = null;
      if (briefSay && performance.now() > briefSay.until) briefSay = null;
      if (limitSay && performance.now() > limitSay.until) limitSay = null;
      if (sunSay && performance.now() > sunSay.until) sunSay = null;
      if (brakeSay && performance.now() > brakeSay.until) brakeSay = null;
      if (breakSay && performance.now() > breakSay.until) breakSay = null;
      if (flowSay && (performance.now() > flowSay.until || state.notesMode === 'quiet')) { flowSay = null; flowQueue = []; }
      const quiet = limitSay || briefSay || cornersSay || alongSay || brakeSay || sunSay || breakSay || flowSay;
      if (quiet && live && performance.now() - state.liveAt < 2500 && !speech.busy && !speech.queue.size && performance.now() > speech.talkingUntil) {
        const quietReach = lead + vMps * (0.6 + 0.07 * quiet.text.length + 2);
        const callDue = ev.some(e => noteM(e) - state.cursorM < quietReach && !state.spoken.has(`${track.id}:${e.type}:${e.index}`)
          && (e.type === 'corner' ? spirited : (spirited || noteworthyInCruise(e))));
        const bumpDue = ApexRoadMemory.upcoming(hazardMemory, state.live, 0, quietReach, { has: () => false });
        if (!callDue && !bumpDue) { say(quiet.text); if (quiet === limitSay) limitSay = null; else if (quiet === briefSay) briefSay = null; else if (quiet === cornersSay) cornersSay = null; else if (quiet === alongSay) alongSay = null; else if (quiet === brakeSay) brakeSay = null; else if (quiet === sunSay) sunSay = null; else if (quiet === breakSay) breakSay = null; else { flowSay = flowQueue.shift() || null; if (flowSay) flowSay.until = performance.now() + 20000; } }
      }
    }

    // =======================================================================
    // 7. RENDER LOOP — replay (recorded), sim (route at envelope), live (native)
    // =======================================================================
    function sectorAt(i) { return track && track.sectors ? track.sectors.find(s => i >= s.start_index && i <= s.end_index) || null : null; }
    let lastNotesAt = 0;
    // Where on the route the car is (web/reroute.js matchRoute). A loop passes the same place at its start and its end, and
    // an out-and-back, a GPX that doubles back or a lap driven twice uses the same road twice: of the stretches within 40 m,
    // the one going the car's way, then the one nearest the progress so far, so the start of a loop is never read as its end
    // (the owner's car, 2026-10-29) and the return leg never as the way out (U-90: "Back on route" 140 times in 36 s, then
    // "Wrong way" for seven minutes on the route). The anchor is the cursor, which holds still while off route. One match
    // per fix: render runs every frame with the same fix.
    const routeMatch = { L: null, track: null, hit: null };
    function matchOnRoute(L) {
      if (routeMatch.L === L && routeMatch.track === track) return routeMatch.hit;
      const hit = ApexReroute.matchRoute(track, L.lat, L.lon, { anchorM: state.cursorM, headingDeg: L.course_deg, speedMps: L.speed_mps });
      Object.assign(routeMatch, { L, track, hit });
      return hit;
    }
    const renderIn = { sight: {}, cluster: {} };                         // F-18: render()'s per-frame inputs, reused
    function render(snap) {
      let lat, lon, bearing, vMps, latG, lonG, camber, idx = -1;
      const live = state.mode === 'live' && state.live;
      if (live) {
        const L = state.live;
        lat = L.lat; lon = L.lon; vMps = L.speed_mps; latG = L.lat_g; lonG = L.lon_g;
        // HE-1 / LA-3: banking only from a calibrated mount (the recorder's own rule, sensors.js); before that the pipeline's
        // number is no measurement, and Bank reads --, never +0.0°
        camber = L.calibration === 'locked' && Number.isFinite(L.camber_deg) ? L.camber_deg : null;
        bearing = L.course_deg != null ? L.course_deg : state.bearing;
        if (track) {
          // The whole route is searched every fix: off route the rejoin can be anywhere on it, and on it the right pass of a
          // road used twice can be anywhere too (U-90).
          const free = track.kind === 'horizon';                         // the road ahead is not a route: no rerouting, ETA or traffic
          const hit = matchOnRoute(L);
          if (L !== routeWatch.frame && !free) { routeWatch.frame = L; feedRerouter(L, hit); trafficTick(L, hit); }
          if (hit.distM < 40 && (free || !rerouter.off)) { idx = hit.index; state.cursorM = track.dist[idx]; }
        }
        if (onFreeRoad()) maybeHorizon(L, idx);
      } else if (track && replayOn) {
        const s = sample(track, state.cursorM);
        idx = s.i; lat = s.lat; lon = s.lon; bearing = s.bearing;
        vMps = state.mode === 'sim' ? simSpeed(idx) : s.speedMps;
        latG = s.latG; lonG = s.lonG; camber = s.camberDeg;
        if (replayEnded && state.cursorM < totalM() - 1) paintReplayEnd(false);   // a seek back: it plays on from there
        if (replayEnded) { vMps = 0; latG = 0; lonG = 0; }           // U-110: the drive is over, the dial at rest (Sight hides under 5 mph)
      } else { cluster.update({ speedMph: null }); sightHold.reset(); paintSight(ApexCarPlay.sightMessage(null), false); carLimit(null); return; }
      state.cursorIdx = idx;
      if (latG != null && (Math.abs(latG) > 0.30 || Math.abs(lonG) > 0.35)) state.spiritedAt = performance.now();

      state.bearing = bearing;
      // a replay without a measured roughness here is unknown (the Surface bars stay dark), never a smooth 0
      const rough = live ? state.live.roughness_rms : (idx >= 0 && track.roughG && Number.isFinite(track.roughG[idx]) ? track.roughG[idx] : null);
      const simLat = state.mode === 'sim' && idx >= 0 && vMps ? vMps * vMps * (track.kappa ? track.kappa[idx] : 0) / Core.G_STD : null;
      setVehicle({ lat, lon, bearing, vMps: vMps || 0, onTrack: !!track && idx >= 0, latG: latG != null ? latG : simLat, lonG: lonG || 0, rough }, snap);

      const at = (arr) => (idx >= 0 && arr && arr[idx] != null ? arr[idx] : null);
      const sight = at(track && track.sightM);
      const limit = at(track && track.limitMps);
      const pace = at(track && track.envMps), sightMps = sight != null ? Core.sightSpeedMps(sight) : null;
      // nothing limits you here: the sight line runs to its 400 m cap and no corner asks for less (the Sight cell says Open)
      const sightOpen = sight != null && sight >= Core.SIGHT_MAX_M - 1 && (pace == null || pace >= sightMps - 0.5);
      // U-60: held, stepped and slow to go red (web/carplay.js sightFilter); a seek starts it over. The plate, the car's
      // plate and the Sight cell read the same held value.
      if (snap) sightHold.reset();
      const si = renderIn.sight;                                       // F-18: refilled each frame, never kept by the filter
      si.sight = sightMps != null ? ApexUnits.speed(sightMps) : null; si.open = sightOpen; si.speed = vMps != null ? ApexUnits.speed(vMps) : null;
      si.limit = limit != null ? ApexUnits.speed(limit) : null; si.unit = ApexUnits.speedU();
      const held = sightHold.step(si, performance.now());
      paintSight(held.msg, !!live);
      carLimit(live ? si.limit : null, si.unit);                       // the posted limit's sign on the car's map
      const d = renderIn.cluster;                                       // F-18: one object, refilled each frame (the cluster reads it, keeps nothing)
      // in the chosen units (mph or km/h, U-22); the names are the cluster's
      d.speedMph = vMps != null ? ApexUnits.speed(vMps) : null;
      d.paceMph = pace != null ? ApexUnits.speed(pace) : null;
      // U-130: the Sight cell follows the plate: under 5 mph (8 km/h, as sightFilter) the plate hides and the cell reads --
      const crawl = si.speed != null && si.speed < (/^km/i.test(si.unit) ? 8 : 5);
      d.sightMph = crawl ? null : held.value; d.sightOpen = !crawl && held.open; d.sightQuiet = crawl;
      d.sightShort = !crawl && !!(held.msg && held.msg.short);       // SO-1: the cell is red when the plate is, not sooner
      // the owner, 2026-11-12 (TestFlight, a replay showing PACE 83 beside Sight 65): "why pace and sight different?". The
      // corner's pace and the sight line are two limits; the gauge's PACE (and its lamp) is now the one you drive to, the
      // lower of the two, so it matches the Sight cell whenever the view is what holds you back
      if (d.paceMph != null && Number.isFinite(d.sightMph) && !d.sightOpen) d.paceMph = Math.min(d.paceMph, d.sightMph);
      d.limitMph = limit != null ? ApexUnits.speed(limit) : null;
      d.latG = latG; d.lonG = lonG; d.camberDeg = camber;
      d.tripMi = ApexUnits.longN(live && (idx < 0 || track.kind === 'horizon') ? (drive.rec ? drive.rec.km * 1000 : 0) : state.cursorM); d.totalMi = track && track.kind !== 'horizon' && !(live && idx < 0) ? ApexUnits.longN(totalM()) : null;
      d.sector = sectorAt(idx); d.routeOnly = track && track.kind === 'route';
      d.roadName = live || state.playing ? roadUnder(lat, lon) : null;   // U-67: the road under the car, by the map's name
      // for Tapedeck's meters and Kit (instruments.js): the live roughness, the last line said, a crest close ahead, a blink
      d.rough = rough; d.kitLine = state.kitLine; d.crestAhead = !!state.crestAhead; d.blink = performance.now() < (state.blinkUntil || 0);
      d.score = live ? liveScore.value : null;   // the drive's Vetta Score so far (liveScoreTick), only while recording
      cluster.update(d);
      sightAlarm(d, !!live);
      soundtrackTick(d, vMps, !!live);
      if (live && explainOpen() && !explainGate()) closeExplain();   // PR-1: the car moved off: nothing left to read
      updateRibbon(vMps, idx, snap);
      updatePins();
      const now = performance.now();
      if (live) paceDetail(vMps);                                     // F-05: less to draw at speed
      // F-14: a fast replay rewrites the strip at 4 Hz (it reads the same, and each rewrite is a layout)
      if (snap || now - lastNotesAt > (!live && state.rate > 2 ? 250 : 150)) { lastNotesAt = now; updateNotes(vMps, live); drawScrubber(); }
    }
    // The Soundtrack (web/soundtrack.js on web/audio_bus.js; docs/ARCHITECTURE.md section 5; Garage > Co-driver, off until
    // asked for): music made by the road while a drive runs. The bus hears the calibrated g, the corners inside 400 m (a
    // route's or the road's own, horizon.js) and the Sight alarm; it never hears speed as anything but a distance turned
    // into a time. Unknown g (the mount not set yet) is passed as unknown, and the music rests on its pad.
    const soundtrack = { eng: null, bus: null, at: 0, frame: null, demo: 0 };
    function soundtrackCorners() {
      if (!track || !Array.isArray(track.events)) return null;
      const out = [];
      for (const e of track.events) {
        if (e.type !== 'corner') continue;
        const ahead = noteM(e) - state.cursorM;
        if (ahead < 0 || ahead > ApexAudioBus.HORIZON_M) continue;
        const n = /^[LR](\d)/.exec(e.code || '');
        out.push([ahead, n ? ApexAudioBus.severity(Number(n[1])) : /^[LR](HP|SQ|AC)/.test(e.code || '') ? 1 : null]);
      }
      return out;
    }
    // the app's audio session stays up while it plays (ApexNavApp.swift setSoundtrack), and goes back when it stops
    function soundtrackNative(on) { if (NATIVE_SHELL) { try { window.webkit.messageHandlers.apex.postMessage({ cmd: 'soundtrack', on }); } catch (_) {} } }
    function soundtrackEngine() {
      if (!soundtrack.eng) { soundtrack.eng = ApexSoundtrack.create(ApexVoice.unlock()); soundtrack.bus = ApexAudioBus.create(); }
      return soundtrack.eng;
    }
    function soundtrackStop() {
      if (soundtrack.demo || !soundtrack.eng || !soundtrack.eng.playing()) return;
      soundtrack.eng.stop(); soundtrackNative(false); soundtrack.at = 0; soundtrack.frame = null;
    }
    function soundtrackTick(d, vMps, live) {
      if (soundtrack.demo) return;
      const want = live && driveActive && !pendingEnd && state.toggles.soundtrack === true && window.ApexSoundtrack && window.ApexAudioBus && window.ApexVoice;
      if (!want) { soundtrackStop(); return; }
      const now = performance.now();
      if (soundtrack.at && now - soundtrack.at < 90) return;                 // the bus runs at 10 Hz, whatever the screen draws at
      const dt = soundtrack.at ? (now - soundtrack.at) / 1000 : 0; soundtrack.at = now;
      try {
        const eng = soundtrackEngine(), L = state.live || {};
        if (!eng.playing()) { soundtrack.bus.reset(); soundtrackNative(true); eng.start((Date.now() / 1000) >>> 0); }
        const g = !L.calibration || L.calibration === 'locked';              // before the mount is set, g is no measurement
        soundtrack.frame = soundtrack.bus.step(dt, { lat_g: g ? d.latG : null, lon_g: g ? d.lonG : null, speed_mps: vMps, corners: soundtrackCorners(),
          over_sight: Inst.sightShort(d), speaking: !!speech.busy });
        eng.set(soundtrack.frame);
      } catch (_) {}
    }
    // "Hear a sample" beside the switch: 24 s of a made-up road (a straight, a build, a corner, the way out), said to be a
    // sample. It is the only time the music plays a road that was not driven, and it never plays in a drive.
    function soundtrackSample(key) {
      if (!window.ApexSoundtrack || !window.ApexAudioBus || !window.ApexVoice) return;
      const end = () => { clearInterval(soundtrack.demo); soundtrack.demo = 0; if (soundtrack.eng) soundtrack.eng.stop(); soundtrackNative(false); key.textContent = 'Hear a sample'; };
      if (soundtrack.demo) { end(); return; }
      if (state.mode === 'live') { toast('The sample plays when you are not driving.'); return; }
      try {
        const eng = soundtrackEngine(), bus = ApexAudioBus.create(); let t = 0;
        soundtrackNative(true); eng.start(20261110); key.textContent = 'Stop';
        soundtrack.demo = setInterval(() => {
          t += 0.1; if (t > 24) { end(); return; }
          const ahead = 170 - 15 * (t - 4), inCorner = t > 15.3 && t < 20;        // 4 s of straight, 11 s toward a corner, through it, out
          eng.set(bus.step(0.1, { lat_g: inCorner ? 0.5 * Math.sin((t - 15.3) / 4.7 * Math.PI) : 0.02, lon_g: t > 13 && t < 15.3 ? -0.25 : 0.02, speed_mps: 15,
            corners: t > 4 && ahead >= 0 ? [[ahead, 0.8]] : [], over_sight: false, speaking: false }));
        }, 100);
      } catch (_) { end(); }
    }
    // Panel round 2 (GR-1, IN-3): the one alarm says so in words and in the hand. Going faster than Sight in a drive, the
    // status row's message line says "Slow to 45 for what you can see." for 3 s, in the signal colour with its mark, and the
    // hazard haptic fires once; again only if Sight drops a step while you are over it, or after 10 s back under it.
    function sightAlarm(d, live) {
      const S = sightAlarm.s || (sightAlarm.s = { short: false, value: null, endedAt: -Infinity }), short = live && Inst.sightShort(d), now = performance.now();
      if (!short) { if (S.short) S.endedAt = now; S.short = false; S.value = null; return; }
      const v = Inst.sightValue(d), fresh = !S.short && now - S.endedAt > 10000, drop = S.short && S.value != null && v < S.value - 1;
      if (fresh || drop) { if (fresh) haptic('hazard'); driveNote(Inst.slowLine(v), { alarm: true, ms: 3000 }); }
      S.short = true; S.value = v;
    }
    // Panel round 2 (PR-1, SO-4): a tap on an instrument says what it means and how it is measured, in a short sheet, only
    // parked or in a replay (ApexInstruments.explainAllowed). While you drive the tap does nothing, and a sheet left open
    // closes as the car moves off. No screen before Start: the sheet is there only when someone asks.
    const explainGate = () => Inst.explainAllowed({ live: state.mode === 'live' && !!state.live, speedMps: state.live ? state.live.speed_mps : null });
    const explainOpen = () => $('explainCard').classList.contains('show');
    function openExplain(key) {
      const e = Inst.EXPLAIN[key];
      if (!e || !explainGate()) return false;
      let now = '';
      try { now = e.now(renderIn.cluster || {}, ApexUnits.speedU()); } catch (_) { now = ''; }
      $('explainTitle').textContent = e.title;
      $('explainNow').textContent = now ? `Now: ${now}` : ''; $('explainNow').hidden = !now;
      $('explainWhat').textContent = e.what; $('explainHow').textContent = e.how;
      $('explainCard').classList.add('show');
      return true;
    }
    function closeExplain() { $('explainCard').classList.remove('show'); }
    for (const id of ['cluster', 'notes']) {
      $(id).addEventListener('click', (ev) => {
        const t = ev.target && ev.target.closest ? ev.target.closest('[data-explain]') : null;
        if (!t || ev.target.closest('button, a')) return;                // the Trip key and links keep their own taps
        openExplain(t.dataset.explain);
      });
    }
    $('explainDone').addEventListener('click', closeExplain);
    onBackdrop($('explainCard'), closeExplain);
    const simSpeed = (i) => Math.max(6, Math.min(track.envMps[i] * 0.92, track.limitMps && track.limitMps[i] ? track.limitMps[i] : 27));

    let lastTs = 0, raf = null, video = null;   // video: a replay being recorded (startVideo below)
    // U-110: a finished replay says it ended. The plate reads "Replay finished · 788" (the drive's Score as the Log has it),
    // the strip "That's the drive", the dial 0 and Sight -- (render), and Play becomes Again. Play, a seek back or another
    // drive clears it. Done is the solid key already.
    // (replayEnded, replayWaiting: declared with the state at the top, read by render and the strip)
    function paintReplayEnd(on) {
      if (replayEnded === on) return;
      replayEnded = on;
      const b = $('playBtn'), label = b.querySelector('span');
      b.classList.toggle('again', on);
      if (label) label.textContent = on ? 'Again' : 'Play';
      if (on) b.setAttribute('aria-label', 'Play it again from the start'); else b.removeAttribute('aria-label');
      if (state.mode === 'replay' || state.mode === 'sim') {
        const name = state.mode === 'sim' ? 'Fly-through' : 'Replay', score = state.mode === 'replay' && track && Number.isFinite(track.score) ? ` · ${track.score}` : '';
        $('modePlate').textContent = on ? `${name} finished${score} ×`
          : state.mode === 'sim' ? 'Fly-through ×' : `Replay${track && track.demo ? ' · Demo' : ''}${track && track.name ? ' · ' + track.name : ''} ×`;
      }
    }
    // U-128: a replay opens on the drive, never a void. The trail is drawn and the clock starts once the map has its tiles at
    // the drive's start, where the follow camera already is (or after REPLAY_WAIT_MS whatever the network does); meanwhile the
    // strip names the drive rather than a quiet line with no road, and the road under the car is looked up afresh.
    const REPLAY_WAIT_MS = 4000;
    async function replayWhenReady(t) {
      replayWaiting = true; render(true);
      const until = performance.now() + REPLAY_WAIT_MS;
      while (!mapReady && performance.now() < until) await new Promise((ok) => setTimeout(ok, 100));
      if (mapReady && track === t) {
        loadTrackOnMap();
        await new Promise((ok) => { let over = false; const done = () => { if (!over) { over = true; ok(); } };
          map.once('idle', done); map.triggerRepaint(); setTimeout(done, Math.max(0, until - performance.now())); });
      }
      replayWaiting = false; roadNow.at = -Infinity;
      if (track === t && replayOn && state.mode !== 'live') setPlaying(true); else render(true);
    }
    function tick(ts) {
      raf = null;
      if (!state.playing || !track || state.mode === 'live') return;
      const dt = Math.min(0.1, (ts - (lastTs || ts)) / 1000);
      lastTs = ts;
      const s = sample(track, state.cursorM);
      const v = state.mode === 'sim' ? simSpeed(s.i) : Math.max(2, s.speedMps);
      state.cursorM += v * state.rate * dt;
      if (state.cursorM >= totalM()) { state.cursorM = totalM(); setPlaying(false); paintReplayEnd(true); render(true); return; }
      render(false);
      raf = requestAnimationFrame(tick);
    }
    function setPlaying(on) {
      state.playing = on && !!track && state.mode !== 'live';
      if (!state.playing && video) { video.stop(); video = null; }      // the replay ended or paused: the video ends with it
      $('playBtn').classList.toggle('on', state.playing); $('playBtn').setAttribute('aria-checked', String(state.playing));
      if (state.playing) {
        paintReplayEnd(false);
        if (state.cursorM >= totalM() - 1) state.cursorM = 0;
        if (!state.follow) resumeFollow();
        lastTs = 0; if (!raf) raf = requestAnimationFrame(tick);
      }
    }
    // The replay as a video (flyover_video.js, IDEAS D-10): from the start, at the chosen speed, with the note and speed on it.
    const canRecord = !!(window.ApexFlyoverVideo && ApexFlyoverVideo.canRecord());   // no recorder or canvas stream here: no key
    $('videoBtn').hidden = !canRecord;
    function startVideo() {
      if (!track || state.mode === 'live' || !mapReady) return;
      const t = track;
      // a portrait map (the phone) records 9:16 for Reels and Shorts; the speed only when the clip switch shows it
      const cv = map.getCanvas(), portrait = !!cv && cv.height > cv.width, speedOn = !ApexFlyoverVideo.speedShown || ApexFlyoverVideo.speedShown();
      video = ApexFlyoverVideo.start({ map, fps: 30, portrait,
        overlay: () => { const s = sample(t, state.cursorM), n = lastNotes[0];
          return { title: t.name, note: n ? `${n.call}${n.dist != null ? ` · ${n.dist}${n.unit || ''}` : ''}` : '', speed: speedOn && Number.isFinite(s.speedMps) ? `${Math.round(ApexUnits.speed(s.speedMps))} ${ApexUnits.speedU()}` : '' }; },
        onStop: async (blob, mime) => { $('videoBtn').classList.remove('on'); $('videoBtn').textContent = 'Video';
          if (!(blob.size > 0)) { toast('Couldn\'t record the video on this phone.'); return; }
          // its caption (corner_clip.js caption: the road, where the app is, the tags) copied as it is shared
          try { await ApexLazy.load('clips'); } catch (_) {}
          const rec = t.id && window.ApexRecording ? await ApexRecording.get(t.id).catch(() => null) : null;
          let copied = false;
          const caption = window.ApexCornerClip && ApexCornerClip.caption ? ApexCornerClip.caption(rec || { name: t.name }, '') : '';
          const r = await ApexSaveFile.saveFile(blob, ApexFlyoverVideo.fileName(t.name, mime), mime.split(';')[0], { caption, copied: () => { copied = true; } });
          if (r !== 'cancelled') toast(copied ? 'Video ready. Its caption is copied.' : 'Video ready.'); } });
      if (!video) { toast('This browser can\'t record video.'); return; }
      $('videoBtn').classList.add('on'); $('videoBtn').textContent = 'Stop';
      state.cursorM = 0; resumeFollow(); setPlaying(true);
      toast('Recording the replay. Tap Stop to end it early.');
    }
    $('videoBtn').addEventListener('click', () => { if (video) { const v = video; video = null; v.stop(); setPlaying(false); } else startVideo(); });
    // Idle = nothing playing and not driving: just the map, Start drive and the tabs. A replay or a route preview wakes the gauges and the notes.
    let replayOn = false, booting = true;
    function paintIdle() {
      const idle = !replayOn && state.mode !== 'live';
      $('app').classList.toggle('idle', idle);
      // feedback 01: one surface owns the screen. A replay or a route preview has the gauges and transport; the route card,
      // Where to? and the tabs step aside until Done (or the plate's ×) brings them back, never all stacked at once.
      $('app').classList.toggle('replaying', replayOn && state.mode !== 'live');
      $('modePlate').hidden = idle || state.mode === 'live';   // driving: the drive bar under the map says it
      $('modePlate').setAttribute('role', replayOn && state.mode !== 'live' ? 'button' : 'status');
      paintPlacePlate();
      if (idle) { try { paintHere(); } catch (_) { /* before the card's own state is set up */ } }   // back from a fly-through: the dot is where it was left
    }
    function setMode(mode) {
      state.mode = mode;
      etaPace.reset(); etaText = '';                                  // a drive starts (or ends): the pace starts over
      if (mode === 'live') { cancelHold(); closePin(); $('hlOverlay').classList.remove('show'); }
      paintLevelCards();
      paintAlternates();
      if (mode === 'live' && explore) showExplore(null);           // its times were from where you were
      $('modePlate').textContent = { replay: `Replay${track && track.demo ? ' · Demo' : ''}${track && track.name ? ' · ' + track.name : ''} ×`, sim: 'Fly-through ×', live: 'Drive ● Rec' }[mode];
      $('modePlate').classList.toggle('live', mode === 'live');
      paintIdle();
      updateTwisty();
      applyPlaces();
    }
    // Names are known now: pre-render them in the co-driver's own voice (only when the owner turned Speak-road-names / LIVE on).
    function prefetchNames(t) {
    if (state.liveVoice && state.voiceId !== 'device' && window.ApexVoice) {
      ApexVoice.load(state.voiceId).then(() => {
        const style = ApexVoice.bank.style, texts = [spokenTextFor(`${t.name}.`, style)];
        // Every call of the route that the bank cannot play as a single clip, in driving order.
        if (ApexVoice.bank.engine === 'kokoro') {
          const ev = t.events.slice().sort((a, b) => a.dist_m - b.dist_m);
          for (const e of ev) {
            if (e.type === 'alpr') continue;
            const chain = [e]; let cur = e;
            for (let h = 0; h < 2 && (cur.link === 'into' || cur.link === 'and'); h++) {
              const nx = ev[ev.indexOf(cur) + 1]; if (!nx) break; chain.push(nx); cur = nx;
            }
            const voiced = chain.map((n, i) => (i === chain.length - 1 && (n.link === 'into' || n.link === 'and')) ? { ...n, link: null } : n);
            if (ApexVoice.joins(ApexVoice.tokensFor(voiced, style)) > 0) texts.push(spokenTextFor(voiced.map((n, i) => (i ? `${voiced[i - 1].link} ` : '') + n.call).join(' ') + (cur.link && cur.link !== 'into' && cur.link !== 'and' ? `, ${cur.link}` : ''), style));
          }
        }
        // the directions at each turn with their street names (the clips say them without; this says them whole)
        for (const st of t.steps || []) { const p = window.ApexDirections && ApexDirections.phrase(st); if (p && / onto | toward /.test(p)) texts.push(p); }
        ApexVoice.prefetch(texts);
      }).catch(() => {});
    }
    }
    // Free driving (REVIEW.md 3.1): Start with no route still calls the corners of the road you're on. The road ahead comes
    // from the map's own road lines (horizon.js: followed through plain junctions only, never a guessed turn) and becomes a
    // track of its own kind, 'horizon', that the notes and the co-driver read like a route's. It is not drawn, rerouted or
    // timed; it is rebuilt near its end, after a junction, or once you leave it; corners already called aren't called again.
    const FREE_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'raceway', 'busway']);
    const free = { busy: false, at: 0, offSince: 0 };
    function onFreeRoad() { return driveActive && state.mode === 'live' && !(track && track.kind === 'route'); }
    function maybeHorizon(L, idx) {
      const now = performance.now(), t = track && track.kind === 'horizon' ? track : null;
      const off = !!t && idx < 0;
      free.offSince = off ? (free.offSince || now) : 0;
      if (free.busy || now - free.at < 2000) return;
      if (t && !(off && now - free.offSince > 3000) && !(totalM() - state.cursorM < 600)) return;
      if (!Number.isFinite(L.course_deg) || !(L.speed_mps > 3) || !mapReady) return;   // a heading needs motion
      free.at = now; free.busy = true;
      buildHorizon(L).catch(() => {}).finally(() => { free.busy = false; });
    }
    async function buildHorizon(L) {
      let feats = [];
      try { feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' }); } catch (_) { return; }
      const dLat = 0.03, dLon = dLat / Math.max(0.2, Math.cos(L.lat * Math.PI / 180)), lines = [];   // about 3 km round you
      for (const f of feats) {
        const cls = f.properties && f.properties.class, g = f.geometry;
        if (!FREE_CLASSES.has(cls) || !g) continue;
        const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
        for (const p of parts) if (p.some(([lo, la]) => Math.abs(la - L.lat) < dLat && Math.abs(lo - L.lon) < dLon)) lines.push({ coords: p, cls });
      }
      const h = window.ApexHorizon ? ApexHorizon.ahead(lines, { lat: L.lat, lon: L.lon, heading: L.course_deg }, 2500) : null;
      if (!h || !onFreeRoad()) return;
      const t = await trackFromPolyline(h.coords, 'horizon', 'The road ahead');
      if (!onFreeRoad()) return;
      t.kind = 'horizon'; t.subtitle = 'The road ahead, from the map'; t.horizonEnd = h.end;
      useHorizon(t);
    }
    function useHorizon(t) {
      const old = track && track.kind === 'horizon' ? track : null, cos = Math.cos(t.lat[0] * Math.PI / 180);
      const said = old ? old.events.filter(e => state.spoken.has(`${old.id}:${e.type}:${e.index}`)) : [];
      if (old && Array.isArray(old.marks)) free.marksSaid = [...(free.marksSaid || []), ...old.marks.filter(e => state.spoken.has(`${old.id}:${e.type}:${e.index}`))].slice(-30);
      track = t; state.cursorM = 0; state.spoken.clear();
      for (const e of t.events) if (said.some(k => k.type === e.type && Math.hypot((k.lat - e.lat) * 110540, (k.lon - e.lon) * 111320 * cos) < 25)) state.spoken.add(`${t.id}:${e.type}:${e.index}`);
      if (mapReady) map.getSource('apex-route-src').setData({ type: 'FeatureCollection', features: [] });   // not a route: not drawn
      rebuildPins();
      render(false);
      attachHorizonMarks(t);
    }
    // Road marks on the road ahead too (free driving, no route): stop signs, rail crossings, one-lane bridges, fords, deer
    // crossings, gravel, from the map's answer for the horizon's own corridor (osm_overpass.js keeps its 5 km tiles a week,
    // so a road you follow asks once a tile). Off the drive's path; nothing without an answer. A mark called on the last
    // horizon is not called again on the next one, which overlaps it.
    function attachHorizonMarks(t, tries = 0) {
      if (!window.ApexRoadMarks || !t || t.kind !== 'horizon' || !Array.isArray(t.lat) || t.lat.length < 2) return;
      setTimeout(async () => {
        if (track !== t) return;
        const c = { t, route: { coords: Array.from(t.lat, (la, i) => [t.lon[i], la]), times: null }, timeS: null, match: 'map_snap' };
        await contextOn([c], CTX_BUDGET_MS, 'ahead', ['osm_overpass']);
        if (track !== t || !c.ctx || !c.corridor) return;
        t.marks = ApexRoadMarks.union(t.marks, ApexRoadMarks.events(c.ctx, c.corridor, t, (la, lo, lats, lons) => Core.nearestIndex(la, lo, lats, lons, -1)));
        const cos = Math.cos(t.lat[0] * Math.PI / 180);
        for (const e of t.marks) if ((free.marksSaid || []).some(k => k.code === e.code && Math.hypot((k.lat - e.lat) * 110540, (k.lon - e.lon) * 111320 * cos) < 40)) state.spoken.add(`${t.id}:${e.type}:${e.index}`);
        if (t.marks.length) { rebuildPins(); render(false); }
        if (!ApexRoadMarks.mapAnswered(c.ctx) && tries < 2) attachHorizonMarks(t, tries + 1);   // the map's late answer is kept: ask again
      }, tries ? 4000 * tries : 300);
    }
    // seamless (a new route while driving: a reroute, a traffic detour, the way home): the new line replaces the old in one
    // frame, and the follow camera carries on from where it is, never snapped or re-fitted mid-drive.
    function activate(t, startM = 0, { quiet = false, seamless = false } = {}) {
      if (!booting && !quiet) { replayOn = true; }
      // your own notes from a recce drive (recce.js, IDEAS V-09) read on the same corners, same direction
      try { if (window.ApexRecce && Array.isArray(t.events)) ApexRecce.apply(ApexRecce.load(localStorage), t); } catch (_) {}
      track = t;
      paintReplayEnd(false);                                           // U-110: a new replay is not finished
      state.cursorM = Math.max(0, Math.min(totalM(), startM));
      refreshAutoNight();
      state.spoken.clear();
      rerouter.routeChanged(); trafficMon.routeChanged(Date.now()); etaPace.reset(); routeWatch.note = null; routeWatch.frame = null; routeWatch.bestM = 0; routeWatch.offAt = null;
      if (state.mode !== 'live') setMode(t.kind === 'drive' ? 'replay' : 'sim');
      loadTrackOnMap();
      fetchAlpr(t);
      showMeasured(t);
      prefetchNames(t);
      if (seamless) { render(false); return; }
      resumeFollow();
      render(true);
    }

    // =======================================================================
    // 8. ALPR — real cameras from OpenStreetMap (DeFlock) via Overpass
    // =======================================================================
    // What other members have measured along this route (banking, roughness). Members only; silent when signed out or offline.
    async function showMeasured(t) {
      const note = $('measuredNote'); note.hidden = true;
      // no signal (membership can't be asked): a saved route's card still names the reports kept with it
      if (navigator.onLine === false && t === plannedRoute && window.ApexRouteReports && t.id && ApexRouteReports.load(localStorage, String(t.id))) paintRouteReports(t);
      // no signal: a saved route's members' road feel kept on the phone (route_feel.js), so its corners and bumps still come
      if (navigator.onLine === false && t.measured === undefined && window.ApexRouteFeel && t.id && Array.isArray(t.dist) && ApexSavedRoutes.has(localStorage, t.id)) {
        const k = ApexRouteFeel.load(localStorage, String(t.id), t.dist);
        if (k) t.measured = k;
      }
      // one bar that carries nothing (the phone says online, nothing gets through): signed in on this phone, but membership
      // or the members' data couldn't be asked, so the kept copy stands in, as with no signal
      const keptCopy = () => (window.ApexRouteFeel && t.id && Array.isArray(t.dist) && ApexSavedRoutes.has(localStorage, t.id) && window.ApexSync && ApexSync.signedIn()
        ? ApexRouteFeel.load(localStorage, String(t.id), t.dist) : null);
      let keptFeel = !!(t.measured && t.measured.keptAt != null);
      if (!window.ApexContributor || !t.lat || t.lat.length < 40) return;
      if (!keptFeel && t.measured === undefined) {
        const me = window.ApexSync ? await RouteLoading.optional(ApexSync.member(), 8000) : null;
        if (!me) { const k = keptCopy(); if (!k) return; t.measured = k; keptFeel = true; }
      } else if (!keptFeel && (!window.ApexSync || !(await ApexSync.member()))) return;
      if (t.measured === undefined) {
        try { t.measured = await ApexContributor.measuredAlong(t, async (ids) => { const r = await apiCall('GET', `/api/roads?ways=${ids.join(',')}`); return r.ok ? r.json() : null; }); }
        catch (_) { t.measured = null; }
        if (t.measured == null) { const k = keptCopy(); if (k) t.measured = k; }
        keepFeelAlong(t);
      }
      if (t === plannedRoute) paintRouteReports(t);
      const m = t.measured;
      // the corners members actually drove, where the map simplified them (IDEAS Q-04); never mid-drive
      if (state.mode !== 'live' && applyCrowdCurvature(t, m) && track === t) { state.spoken.clear(); loadTrackOnMap(); render(true); }
      if (applyCrowdBumps(t, m) && track === t) render(false);

      if (t === plannedRoute) renderRouteCard(t);
      if (!m || track !== t) return;
      note.hidden = false;
      note.textContent = m.coveredKm < 0.05
        ? 'No member measurements on this route yet. Drive it with Share road feel on to be the first (3× points).'
        : `Measured by members: ${ApexUnits.long(m.coveredKm * 1000, 1)} of ${ApexUnits.long(m.km * 1000, 1)} (${Math.round(m.coverage * 100)}%)` +
          (m.roughness != null ? ` · roughness ${m.roughness.toFixed(2)}` : '') + (m.bankedKm >= 0.05 ? ` · ${ApexUnits.long(m.bankedKm * 1000, 1)} banked` : '') +
          (m.roughKm >= 0.05 ? ` · ${ApexUnits.long(m.roughKm * 1000, 1)} rough` : '') +
          (m.repavedKm >= 0.05 && m.repavedOn ? ` · ${ApexUnits.long(m.repavedKm * 1000, 1)} repaved ${repavedMonth(m.repavedOn)}` : '') +
          (m.avgPasses != null ? ` · ${m.avgPasses.toFixed(1)} runs on average` : '') +
          (t.crowdCorrected >= 30 ? ` · corners from members' drives on ${ApexUnits.long(t.crowdCorrected, 1)}` : '') +
          (t.crowdBumps > 0 ? ` · ${t.crowdBumps === 1 ? 'a bump' : `${t.crowdBumps} bumps`} members felt` : '') +
          (m.keptAt != null ? ` (kept ${keptWhen(m.keptAt)})` : '');
    }
    // A saved route keeps what members measured along it (route_feel.js), refreshed whenever its card asks with signal.
    function keepFeelAlong(t) {
      if (!t || !t.id || !window.ApexRouteFeel || !t.measured || t.measured.keptAt != null || !Array.isArray(t.dist)) return;
      if (ApexSavedRoutes.has(localStorage, t.id)) ApexRouteFeel.save(localStorage, String(t.id), t.measured, t.dist);
    }
    const keptWhen = (ms) => {
      const d = new Date(ms), now = new Date();
      return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };
    // Hand reports beside a planned route (road_page.js onThisRoad, within 30 m; cleared ones left out), one line on the
    // card: what members said is on the way. Members only; offline or none says nothing.
    async function paintRouteReports(t) {
      const line = $('routeCardReports');
      if (!line || !t || !Array.isArray(t.lat) || t.lat.length < 2 || !window.ApexRoadPage) return;
      if (line.dataset.for !== String(t.id || t.name)) line.hidden = true;
      const pts = [];
      for (let i = 0; i < t.lat.length; i += 200) pts.push({ lat: t.lat[i], lon: t.lon[i] });
      pts.push({ lat: t.lat[t.lat.length - 1], lon: t.lon[t.lon.length - 1] });
      // no signal: the reports kept when the route was saved (route_reports.js), expired ones dropped, with their age
      // (or one bar that carries nothing: the live ask didn't get through in 8 s)
      const keptCopy = () => (window.ApexRouteReports && t.id ? ApexRouteReports.load(localStorage, String(t.id)) : null);
      let kept = navigator.onLine === false ? keptCopy() : null, list = [];
      if (!kept) {
        try { list = await RouteLoading.optional(hazardsAround(pts), 8000); } catch (_) { return; }
        if (!list || list.unknown) { kept = keptCopy(); if (!kept) return; }
      }
      if (kept) list = kept.rows;
      if (plannedRoute !== t) return;
      let text = ApexRoadPage.routeReportsLine(ApexRoadPage.onThisRoad(t, null, Array.isArray(list) ? list : []), (m) => ApexUnits.long(m, 1));
      if (text && kept) text += ` (as of ${new Date(kept.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${Date.now() - kept.at > 864e5 ? `, ${new Date(kept.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''})`;
      line.dataset.for = String(t.id || t.name);
      line.textContent = text ? ApexRouteCard.factText(text) : ''; line.hidden = !text;
    }
    const repavedMonth = (ym) => { const d = new Date(ym + '-15T12:00:00Z'); return Number.isFinite(d.getTime()) ? d.toLocaleDateString([], { month: 'short', year: 'numeric' }) : ym; };
    // Enforcement cameras in a box [s, w, n, e] (web/cameras.js: plate readers and speed cameras from OSM, by tile, kept a
    // week, the servers raced); null offline.
    try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('apex.alpr.')) localStorage.removeItem(k); } } catch (_) {}   // the old per-box cache
    async function alprNodesIn(s, w, n, e) {
      const cams = await ApexCameras.load(ApexCameras.tilesInBox(s, w, n, e));
      return cams && cams.filter((c) => c.lat >= s && c.lat <= n && c.lon >= w && c.lon <= e);
    }
    async function fetchAlpr(t) {
      if (t.alpr) return;
      // only the tiles the route passes through, not its whole bounding box (a long diagonal route was a huge query)
      const pts = [];
      for (let i = 0; i < t.lat.length; i += 20) pts.push([t.lat[i], t.lon[i]]);
      pts.push([t.lat[t.lat.length - 1], t.lon[t.lon.length - 1]]);
      const nodes = await ApexCameras.load(ApexCameras.tilesNear(pts));
      if (track === t) {
        // no signal: a kept list past its week still pins the cameras (cameras.js keptAt), and the note says how old it is
        const note = $('camOfflineNote'), aged = nodes && Number.isFinite(nodes.keptAt);
        note.textContent = aged ? `Camera map from ${new Date(nodes.keptAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}, no signal to check for newer ones.` : "Camera map offline. No pins doesn't mean no cameras.";
        note.hidden = !!nodes && !aged;
      }
      if (nodes) { attachAlpr(t, nodes); return; }
      // U-102: no toast over the replay's map: the Layers sheet, under Cameras, says the camera map is offline
    }
    function attachAlpr(t, nodes) {
      t.alpr = [];
      const counts = new Map();
      for (const node of nodes) {
        const hit = Core.nearestIndex(node.lat, node.lon, t.lat, t.lon, -1);
        if (hit.distM > Core.ALPR_RADIUS_M) continue;
        const speed = node.kind === 'speed';                           // a speed camera rides with the plate readers (same switch, same pin)
        t.alpr.push({ type: 'alpr', kind: speed ? 'speed' : 'alpr', code: speed ? 'SPD' : 'LPR', call: speed ? 'Speed camera' : 'Camera', index: hit.index, dist_m: t.dist[hit.index], lat: node.lat, lon: node.lon });
        if (t.sectors && !speed) { const sid = Math.floor(t.dist[hit.index] / t.sectorM); counts.set(sid, (counts.get(sid) || 0) + 1); }
      }
      // Same rule as core/road_dna.score_sectors: -45 per camera within ALPR_RADIUS_M.
      if (t.sectors) for (const sec of t.sectors) sec.clear = Math.max(0, 100 - 45 * (counts.get(sec.id) || 0));
      if (t === plannedRoute) renderRouteCard(t);
      if (track === t) {
        loadTrackOnMap(); render(false);
        const lpr = t.alpr.filter((c) => c.kind !== 'speed').length, spd = t.alpr.length - lpr;
        carHazards();
        toast([`${lpr} plate-reading camera${lpr === 1 ? '' : 's'}`, spd ? `${spd} speed camera${spd === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ') + ' on this route');
      }
    }

    // =======================================================================
    // 9. ROUTING — Valhalla (highways de-prioritised) + posted limits; OSRM fallback
    // =======================================================================
    const VALHALLA = 'https://valhalla1.openstreetmap.de';
    function decodePolyline6(str) {
      const out = []; let i = 0, lat = 0, lon = 0;
      while (i < str.length) {
        for (const which of [0, 1]) {
          let shift = 0, result = 0, b;
          do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
          const d = (result & 1) ? ~(result >> 1) : (result >> 1);
          if (which === 0) lat += d; else lon += d;
        }
        out.push([lon / 1e6, lat / 1e6]);
      }
      return out;
    }
    // Avoid options (Plan sheet, saved on the phone): router costing for routes and the connector matrix alike.
    const AVOID = 'apex.avoid';
    let avoid = { ...FunRoute.AVOID_DEFAULT };
    // Your Garage's daily car, kept on the phone: routing plans for it (IDEAS R-20) and drives are scored for it (D-19).
    let carForRouting = null;
    try { carForRouting = JSON.parse(localStorage.getItem('apex.routingCar') || 'null'); } catch (_) {}
    const routingCar = () => carForRouting;
    function setRoutingCars(list) {
      const c = Array.isArray(list) ? list.find(x => x.is_primary) || null : null;
      carForRouting = c ? { clearance: c.clearance || null, width_cm: c.width_cm || null, weight_kg: c.weight_kg || null, tyres: c.tyres || null,
                            fuel: c.fuel || null, range_km: c.range_km || null,   // route_ctx/car.js: fuel-stop spacing
                            label: c.nickname || [c.make, c.model].filter(Boolean).join(' ') } : null;
      try { if (carForRouting) localStorage.setItem('apex.routingCar', JSON.stringify(carForRouting)); else localStorage.removeItem('apex.routingCar'); } catch (_) {}
    }
    try { const a = JSON.parse(localStorage.getItem(AVOID) || 'null'); if (a && typeof a === 'object') for (const k in avoid) if (typeof a[k] === 'boolean') avoid[k] = a[k]; } catch (_) { /* storage off */ }
    // Corners you like (IDEAS R-19): more or fewer hairpins and fast sweepers weigh routes' fun (fun_route.js cornerWeight).
    const ROAD_PREFS = 'apex.roadPrefs';
    let roadPrefs = { tight: 0, fast: 0, measured: false, novel: false, crew: false };
    try { const p = JSON.parse(localStorage.getItem(ROAD_PREFS) || 'null'); if (p && typeof p === 'object') { for (const k of ['tight', 'fast']) if ([-1, 0, 1].includes(p[k])) roadPrefs[k] = p[k]; for (const k of ['measured', 'novel', 'crew']) roadPrefs[k] = p[k] === true; } } catch (_) { /* storage off */ }
    // Junction turns (slight/normal/sharp left and right, U-turns, ramps, roundabouts): fun scoring drops the corners there.
    const TURN_TYPES = new Set([9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 26, 27]);
    function routeOf(trip) {
      const coords = [], turns = [], times = [], steps = [];
      let cumS = 0;
      trip.legs.forEach((leg, i) => {
        const shape = decodePolyline6(leg.shape);
        for (const m of leg.maneuvers || []) if (TURN_TYPES.has(m.type) && shape[m.begin_shape_index]) turns.push(shape[m.begin_shape_index]);
        // spoken directions (IDEAS V-04): where each maneuver is, its type, the road it turns onto, roundabout exits
        for (const m of leg.maneuvers || []) {
          const p = shape[m.begin_shape_index], sign = m.sign || {}, first = (k) => (Array.isArray(sign[k]) && sign[k][0] && sign[k][0].text) || null;
          // lanes and the exit sign (IDEAS R-29): which lanes to use, the exit number and where it goes
          if (p) steps.push({ lon: p[0], lat: p[1], type: m.type, street: (m.street_names && m.street_names[0]) || null, exits: m.roundabout_exit_count,
            lanes: ApexLanes.pack(m.lanes), exit: first('exit_number_elements'), toward: first('exit_toward_elements') });
        }
        // the router's own clock along the route: [lon, lat, seconds so far] at each maneuver, for the live ETA (eta.js)
        for (const m of leg.maneuvers || []) { if (shape[m.begin_shape_index]) times.push([...shape[m.begin_shape_index], cumS]); if (Number.isFinite(m.time)) cumS += m.time; }
        coords.push(...shape.slice(i ? 1 : 0));
      });
      // km on each named road, for "switching to <road>" (traffic detours)
      const names = new Map();
      for (const leg of trip.legs) for (const m of leg.maneuvers || []) {
        const n = m.street_names && m.street_names[0];
        if (n && Number.isFinite(m.length)) names.set(n, (names.get(n) || 0) + m.length);
      }
      const sum = trip.summary || {};
      // what the route uses that the driver may have asked to avoid (undefined = the router didn't say)
      const has = { highways: sum.has_highway, tolls: sum.has_toll, ferries: sum.has_ferry };
      return { coords, turns, names, has, times, steps, timeS: Number.isFinite(sum.time) ? sum.time : null };
    }
    // The router's maneuvers placed on a track for spoken directions (IDEAS V-04; web/directions.js); [] without a router's steps.
    function stepsOf(t, r) {
      if (!r || !Array.isArray(r.steps) || !t || !Array.isArray(t.lat) || !t.lat.length) return [];
      // in route order: the first stretch after the last one placed that comes within 25 m, then its closest point (a loop or an
      // out-and-back passes the same junction twice; the global nearest point could be the other pass)
      const c = Math.cos(t.lat[0] * Math.PI / 180), n = t.lat.length;
      const dm = (i, lat, lon) => Math.hypot((t.lon[i] - lon) * 111320 * c, (t.lat[i] - lat) * 110540);
      let from = 0;
      return ApexDirections.placeSteps(r.steps, (lat, lon) => {
        let i = from;
        while (i < n && dm(i, lat, lon) > 25) i++;
        if (i >= n) return null;
        let best = i;
        for (let j = i + 1; j < Math.min(n, i + 20); j++) if (dm(j, lat, lon) < dm(best, lat, lon)) best = j;
        from = best;
        return t.dist[best];
      });
    }
    // The router's maneuver times placed on a track: [[metres along it, seconds so far]], in order (ApexEta.routerLeft).
    function timeMarksOf(t, r) {
      const out = [];
      if (!r || !Array.isArray(r.times) || !t || !Array.isArray(t.lat) || !t.lat.length) return out;
      let hint = 0;
      for (const [lon, lat, sec] of r.times) {
        const h = Core.nearestIndex(lat, lon, t.lat, t.lon, hint, 2000);
        if (h.distM > 60) continue;                        // a spur cut from a loop, or a point the track doesn't pass
        hint = h.index; out.push([t.dist[h.index], sec]);
      }
      return out;
    }
    // [{ coords, turns: [[lon, lat]], names, timeS }]: the route, then up to `alternates` other ways (two-point requests
    // only). extra: more request options, e.g. { exclude_polygons }.
    // Router calls counted for app health (Y-03): found, failed, and the fallback router used.
    // The car's heading for the router (Valhalla heading / OSRM bearings), in whole degrees; null standing still or without
    // a course, when the router picks the way as it would anyway. 45 degrees either side: a car on a bend still matches.
    const HEADING_TOLERANCE_DEG = 45;
    const headingOf = (L) => (L && Number.isFinite(L.course_deg) && L.speed_mps > 3 ? Math.round(((L.course_deg % 360) + 360) % 360) % 360 : null);
    async function valhallaRoutes(...a) { try { const r = await valhallaRoutesOnce(...a); health.bump('route_ok'); return r; } catch (e) { health.bump('route_fail'); throw e; } }
    async function osrmRoutes(...a) { const r = await osrmRoutesOnce(...a); health.bump('route_fallback'); return r; }
    // Reported road closures (IDEAS Q-17; hazard_reports.js closuresFor): fetched around the trip for members, kept 5 min, and
    // sent to the router as exclude_locations. If no way around them exists, the route is asked again without them.
    const closureCache = { key: '', at: 0, list: [] };
    async function closuresAround(points) {
      const list = await hazardsAround(points);
      // with the closures the drive has fetched round you (newer than this trip's for one that landed mid-drive: Go round)
      let mine = [];
      try { mine = reported.list.filter((h) => h && h.kind === 'closure' && !h.official).concat(roadEvents.closures); } catch (_) { mine = []; }   // (not yet set up at boot)
      const ids = new Set(mine.map((h) => h.id));
      return ApexHazardReports.closuresFor(mine.length ? [...mine, ...list.filter((h) => !h || !ids.has(h.id))] : list, points);
    }
    // Avoid police reports (IDEAS R-35, the owner 2026-11-11): the live "Police" reports near the trip (members' reports
    // from the last hour, and a convoy leader's live call), as router exclusions and as points our own router keeps off.
    // No sign-in, no reports: routed as usual and said once. Never a checkpoint (docs/APP_REVIEW.md 1.4.3).
    let policeNote = 0;
    function convoyPolice() {
      try { return convoy && convoy.client && typeof convoy.client.liveHazards === 'function' ? convoy.client.liveHazards().filter((e) => e.type === 'police' && e.anchor).map((e) => e.anchor) : []; }
      catch (_) { return []; }
    }
    async function policeAround(points) {
      if (!avoid.police || !window.ApexHazardReports) return [];
      let member = false;
      try { member = !!(window.ApexSync && typeof ApexSync.signedIn === 'function' && ApexSync.signedIn()); } catch (_) { member = false; }
      const list = member ? await hazardsAround(points) : [];
      if (!member && performance.now() - policeNote > 60000 && !convoyPolice().length) { policeNote = performance.now(); toast('Sign in to route around police reports.'); }
      // with the reports the drive has fetched round you (newer than this trip's for a report that landed mid-drive: Go round)
      let mine = [];
      try { mine = reported.list.filter((h) => h && h.kind === 'police'); } catch (_) { mine = []; }   // (not yet set up at boot)
      return ApexHazardReports.policeFor(mine.length ? [...mine, ...list] : list, points, Date.now(), convoyPolice());
    }
    // The avoid choices for one plan, with the police reports near it. The route card's budget (~0.75 s) comes first: the
    // reports asked for this area in the last 5 min are used at once; otherwise a plan waits POLICE_WAIT_MS at most and
    // goes without them (the Valhalla requests ask again, by then answered). Where to? opening warms them (policeWarm).
    const POLICE_WAIT_MS = 200;
    const policeCached = (points) => hazardsCover(points);
    // the card's word: { n, passes } for a planned route with Avoid police on and the reports for its area in hand
    const policeSeen = new WeakMap();
    function policeOnCard(t) {
      if (!avoid.police || !t || t.id !== 'route_dest' || !Array.isArray(t.lat) || t.lat.length < 2 || !window.ApexHazardReports) return null;
      const ends = [{ lat: t.lat[0], lon: t.lon[0] }, { lat: t.lat[t.lat.length - 1], lon: t.lon[t.lon.length - 1] }];
      if (!hazardsCover(ends) && !convoyPolice().length) return null;
      const list = hazardsCover(ends) ? closureCache.list : [], kept = policeSeen.get(t);
      if (kept && kept.list === list) return kept.r;
      const pts = ApexHazardReports.policeFor(list, ends, Date.now(), convoyPolice());
      const r = { n: pts.length, passes: pts.length > 0 && ApexHazardReports.passesNear(t.lat.map((la, i) => [t.lon[i], la]), pts) };
      policeSeen.set(t, { list, r });
      return r;
    }
    // the card's word on members' "Road closed" reports: true when a planned route or loop still drives within 40 m of one
    // (graph_router.js CLOSED_M: our router goes round them where it can; with no way round, or a report that landed after
    // the plan, the route goes by, and the driver should know). Reports for the area not in hand: null, nothing said
    const closedSeen = new WeakMap();
    function closedOnCard(t) {
      if (!t || !(t.id === 'route_dest' || /^loop_/.test(t.id || '')) || !Array.isArray(t.lat) || t.lat.length < 2 || !window.ApexHazardReports) return null;
      const ends = [{ lat: t.lat[0], lon: t.lon[0] }, { lat: t.lat[t.lat.length - 1], lon: t.lon[t.lon.length - 1] }];
      let dot = [];
      try { dot = roadEvents.closures; } catch (_) { dot = []; }       // the DOTs' full closures (road_events.js), signed in or not
      if (!hazardsCover(ends) && !dot.length) return null;
      const list = hazardsCover(ends) ? closureCache.list : [], kept = closedSeen.get(t);
      if (kept && kept.list === list && kept.dot === dot) return kept.r;
      const pts = ApexHazardReports.closuresFor(dot.length ? [...list, ...dot] : list, ends);
      const r = pts.length > 0 && ApexHazardReports.passesNear(t.lat.map((la, i) => [t.lon[i], la]), pts, 40);
      closedSeen.set(t, { list, dot, r });
      return r;
    }
    let camWarmAt = -1e9;
    function policeWarm() {
      const p = state.lastPosition;
      // (the reports round you: police for Avoid police, and the closures every plan keeps off, closedForTrip)
      if (p && window.ApexSync && ApexSync.signedIn() && !policeCached([p])) hazardsAround([p]).catch(() => {});
      loadRoadEvents().catch(() => {});                                  // the DOTs' closures and roadwork (road_events.js)
      // the camera tiles round where you are, so a plan that avoids cameras finds them kept (camsForTrip)
      if (avoid.cameras && p && window.ApexCameras && performance.now() - camWarmAt > 60000 && (camWarmAt = performance.now())) alprNodesIn(p.lat - 0.15, p.lon - 0.15, p.lat + 0.15, p.lon + 0.15).catch(() => {});
    }
    // members' "Road closed" reports near the trip, for our own router (graph_router.js CLOSED_X): kept 5 min (hazardsAround),
    // otherwise a plan waits POLICE_WAIT_MS at most and goes without them. Signed out there are none to ask for: []
    // confirmed potholes, gravel and debris near the trip, for our router (graph_router.js HAZARD_X): from the same hazard
    // reports as the closures (kept 5 min, or no wait at all: a plan doesn't wait for these); none known: []
    // Confirmed potholes, gravel and debris (IDEAS R-04, hazard_reports.js roadHazardsFor) for our own router's HAZARD_X
    // nudge: from the reports closedForTrip has just fetched round the trip, with the drive's own (newer); members only,
    // never a wait of its own, and never a reason a plan fails
    function hazardsForTrip(points) {
      try {
        if (!window.ApexHazardReports || !memberNow() || !hazardsCover(points)) return [];
        let mine = [];
        try { mine = reported.list.filter((h) => h && h.kind !== 'police' && h.kind !== 'closure'); } catch (_) { mine = []; }   // (not yet set up at boot)
        const ids = new Set(mine.map((h) => h.id));
        return ApexHazardReports.roadHazardsFor([...mine, ...closureCache.list.filter((h) => !h || !ids.has(h.id))], points);
      } catch (_) { return []; }
    }
    async function closedForTrip(points) {
      if (!window.ApexHazardReports) return [];
      try { loadRoadEvents().catch(() => {}); } catch (_) { /* (not yet set up at boot) */ }
      // signed out: the DOTs' full closures alone (road_events.js), which need no sign-in; the members' reports need one
      if (!memberNow()) { try { return ApexHazardReports.closuresFor(roadEvents.closures, points); } catch (_) { return []; } }
      if (hazardsCover(points)) return closuresAround(points);   // (with the drive's own, newer: closuresAround)
      const list = await RouteLoading.optional(closuresAround(points), POLICE_WAIT_MS).catch(() => null);
      return Array.isArray(list) ? list : [];
    }
    function memberNow() {
      try { return !!(window.ApexSync && typeof ApexSync.signedIn === 'function' && ApexSync.signedIn()); } catch (_) { return false; }
    }
    async function avoidForTrip(points) {
      const closedP = closedForTrip(points).catch(() => []);
      if (!avoid.police && !avoid.cameras) {
        const closed = await closedP, hazards = hazardsForTrip(points);
        if (window.apexDebug) { window.apexDebug.lastClosed = closed; window.apexDebug.lastRoadHazards = hazards; }
        if (!closed.length && !hazards.length) return avoid;
        const out = { ...avoid };
        if (closed.length) out.closed = closed;
        if (hazards.length) out.hazards = hazards;
        return out;
      }
      const camsP = camsForTrip(points);
      const out = { ...avoid };
      if (avoid.police) {
        const t0 = performance.now(), ask = policeAround(points);
        const pts = policeCached(points) ? await ask.catch(() => null) : await RouteLoading.optional(ask, POLICE_WAIT_MS).catch(() => null);
        if (window.apexDebug) window.apexDebug.policeWaitMs = Math.round(performance.now() - t0);
        if (window.apexDebug) window.apexDebug.lastPolice = Array.isArray(pts) ? pts : null;
        out.points = Array.isArray(pts) ? pts : [];
      }
      const cams = await camsP;
      if (window.apexDebug) window.apexDebug.lastCams = cams;
      if (cams) out.cams = cams;
      const closed = await closedP;
      if (window.apexDebug) window.apexDebug.lastClosed = closed;
      if (closed.length) out.closed = closed;
      const hazards = hazardsForTrip(points);
      if (window.apexDebug) window.apexDebug.lastRoadHazards = hazards;
      if (hazards.length) out.hazards = hazards;
      return out;
    }
    // A loop's avoid choices: the same lists as a trip's, for the box a loop of `km` can reach from `c` (a third of its
    // length each way, at most 35 km so the camera map's 1 degree limit holds to 50 degrees north), corner to corner through the start
    function loopAvoidPoints(c, km) {
      const r = Math.max(3, Math.min(35, km / 3)), dLat = r / 110.54, dLon = r / (111.32 * Math.max(0.2, Math.cos(c.lat * Math.PI / 180)));
      return [{ lat: c.lat - dLat, lon: c.lon - dLon }, { lat: c.lat, lon: c.lon }, { lat: c.lat + dLat, lon: c.lon + dLon }];
    }
    // Avoid cameras for every candidate, not only Valhalla's (IDEAS R-35): the plate readers and fixed speed cameras within
    // 5 km of the trip's box (60 nearest its line), so our own router keeps off the roads they sit on and a route that
    // still drives past one gives way to one that doesn't (FunRoute.unavoided). The camera map is kept a week per tile, so
    // this is usually instant; a plan waits CAM_WAIT_MS at most. Too big a trip, the map offline or slow: null (nothing
    // known, nothing said here; the Valhalla request asks again and says so).
    const CAM_WAIT_MS = 250, CAM_PAD_KM = 5;
    async function camsForTrip(points) {
      if (!avoid.cameras || !window.ApexCameras) return null;
      const pts = (points || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (pts.length < 2) return null;
      const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon), pad = 0.05;
      const s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lons), e = Math.max(...lons);
      if (n - s > FunRoute.CAMERA_BOX_DEG || e - w > FunRoute.CAMERA_BOX_DEG) return null;
      const nodes = await RouteLoading.optional(alprNodesIn(s - pad, w - pad, n + pad, e + pad), CAM_WAIT_MS).catch(() => null);
      return Array.isArray(nodes) ? FunRoute.camerasToExclude(nodes, pts, 60, CAM_PAD_KM) : null;
    }
    // The reported hazards around a trip (50 km round its middle, asked by cell, VI-1), kept 5 min and reused for any trip
    // whose points all lie within 35 km of where they were asked for; one request at a time
    const hazardsCover = (points) => !!closureCache.mid && performance.now() - closureCache.at <= 300000
      && points.every((p) => p && FunRoute.kmBetween(p, closureCache.mid) <= 35);
    async function hazardsAround(points) {
      const mid = points[Math.floor(points.length / 2)] || points[0];
      if (!mid || !window.ApexSync) return [];
      if (hazardsCover(points)) return closureCache.list;
      if (closureCache.asking && closureCache.askMid && points.every((p) => p && FunRoute.kmBetween(p, closureCache.askMid) <= 35)) return closureCache.asking;
      const ask = (async () => {
        let list = null;
        try {
          const r = await ApexSync.apiFetch(`/api/hazards?${ApexPrivacyZones.cellQuery(mid.lat, mid.lon, 50)}`, { method: 'GET' });   // VI-1: by cell
          list = r.ok ? await r.json() : [];                                                 // signed out: an answer, none for you
        } catch (_) { list = null; }
        // the ask never got through (no signal, or one bar that carries nothing): not "none reported", so not kept as the
        // area's answer for 5 min; the next plan asks again, and a saved route falls back to the reports kept with it
        if (!Array.isArray(list) && list !== null) list = [];
        if (list === null) { closureCache.asking = null; return Object.assign([], { unknown: true }); }
        Object.assign(closureCache, { key: `${mid.lat.toFixed(1)},${mid.lon.toFixed(1)}`, mid: { lat: mid.lat, lon: mid.lon }, at: performance.now(), list, asking: null });
        // the reports landed after the card went up (a slow answer; a plan waits 0.2 s at most): its word again (police
        // reports with Avoid police on, and a reported closure the route passes, always)
        if (plannedRoute && !driveActive && typeof renderRouteCard === 'function') setTimeout(() => { try { if (plannedRoute) renderRouteCard(plannedRoute); } catch (_) {} }, 0);
        return closureCache.list;
      })();
      Object.assign(closureCache, { asking: ask, askMid: { lat: mid.lat, lon: mid.lon } });
      return ask;
    }
    // Avoid cameras (IDEAS R-35): the plate readers near the trip go to the router as exclude_locations with the closures.
    // A trip too big for one camera-map query, or the map offline, routes without them; the card still counts what is on it.
    let cameraNote = 0, avoidPoints = [];
    async function camerasAround(points, max) {
      if (!avoid.cameras || max <= 0) return [];
      const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
      const s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lons), e = Math.max(...lons), pad = 0.02;
      const note = (msg) => { if (performance.now() - cameraNote > 60000) { cameraNote = performance.now(); toast(msg); } };
      if (n - s > FunRoute.CAMERA_BOX_DEG || e - w > FunRoute.CAMERA_BOX_DEG) { note('Too long a trip to route around cameras. They\'re still marked on the route.'); return []; }
      const nodes = await alprNodesIn(s - pad, w - pad, n + pad, e + pad);
      if (!nodes) { note('Camera map offline: not avoiding cameras this time.'); return []; }
      return FunRoute.camerasToExclude(nodes, points, max);
    }
    async function valhallaRoutesOnce(points, throughRoadsOnly = false, alternates = 0, extra = {}) {
      const closures = await closuresAround(points);
      // roads you chose to route around this session (closed when you'd get there, R-22), near this trip
      closures.push(...FunRoute.camerasToExclude(avoidPoints, points, 10, 1));
      const police = await policeAround(points);
      const cams = await camerasAround(points, 50 - closures.length - police.length);   // the public router takes about 50 exclusions
      if (cams.length || police.length) {
        try { return await valhallaRoutesExcluding(points, throughRoadsOnly, alternates, extra, [...closures, ...police, ...cams]); }
        catch (_) { toast(`No way round every ${police.length && cams.length ? 'camera and police report' : police.length ? 'police report' : 'camera'} on this trip. Routing without avoiding them.`); }
      }
      const excl = closures;
      try { return await valhallaRoutesExcluding(points, throughRoadsOnly, alternates, extra, excl); }
      catch (e) {
        if (!excl.length) throw e;
        toast('A road closure is in the way and there\'s no road around it. Check it before you go.');
        return valhallaRoutesExcluding(points, throughRoadsOnly, alternates, extra, []);
      }
    }
    async function valhallaRoutesExcluding(points, throughRoadsOnly, alternates, extra, excl) {
      // Loop waypoints snap only to through roads (tertiary..primary), never cul-de-sacs or motorways.
      const filter = { min_road_class: 'tertiary', max_road_class: 'primary', exclude_ramp: true };
      const json = await RouteLoading.json(`${VALHALLA}/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        locations: points.map((p, i) => {
          const end = i === 0 || i === points.length - 1;
          if (!end && p.shaping) return { lat: p.lat, lon: p.lon, type: 'through', radius: 25 };   // stay on the stage
          // a route from a moving car leaves the way the car is going (headingOf), never with a U-turn behind it
          return { lat: p.lat, lon: p.lon, type: end ? 'break' : 'through', ...(throughRoadsOnly && !end ? { radius: 2500, search_filter: filter } : {}),
                   ...(i === 0 && Number.isFinite(p.heading) ? { heading: p.heading, heading_tolerance: HEADING_TOLERANCE_DEG } : {}) };
        }),
        ...FunRoute.costing(avoid, routingCar()), ...(alternates && points.length === 2 ? { alternates } : {}), ...(excl.length ? { exclude_locations: excl } : {}),
        turn_lanes: true, ...extra }) });   // turn_lanes: lane data on each maneuver (IDEAS R-29)
      if (!json.trip) throw new Error(json.error || 'no route');
      return [json.trip, ...(json.alternates || []).map(a => a.trip).filter(Boolean)].map(routeOf);
    }
    const valhallaRoute = async (points, throughRoadsOnly = false) => (await valhallaRoutes(points, throughRoadsOnly))[0].coords;
    // Drive time (s) and road distance (km) from every source to every target (null: no road). The public server takes at
    // most 100 pairs a call, so bigger matrices go in several calls of whole source rows, one after another (a burst
    // of parallel calls risks the server's rate limit). Callers send at most 13 targets.
    async function valhallaMatrix(sources, targets, costing = null) {
      const rows = Math.max(1, Math.floor(100 / targets.length)), parts = [];
      for (let i = 0; i < sources.length; i += rows) {
        const src = sources.slice(i, i + rows);
        const json = await RouteLoading.json(`${VALHALLA}/sources_to_targets`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sources: src.map(p => ({ lat: p.lat, lon: p.lon })), targets: targets.map(p => ({ lat: p.lat, lon: p.lon })), ...(costing || FunRoute.costing(avoid, routingCar())) }) });
        if (!Array.isArray(json.sources_to_targets)) throw new Error(json.error || 'no matrix');
        parts.push(json.sources_to_targets);
      }
      const all = parts.flat(), ok = (c) => c && Number.isFinite(c.time) && Number.isFinite(c.distance);   // no time = no road
      return { times: all.map(row => row.map(c => (ok(c) ? c.time : null))), km: all.map(row => row.map(c => (ok(c) ? c.distance : null))) };
    }
    async function osrmRoutesOnce(points) {
      const coords = points.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
      // the fallback router gets the car's heading too (OSRM bearings: value,range for the first point, blank for the rest)
      const bearings = points[0] && Number.isFinite(points[0].heading) ? `&bearings=${points.map((p, i) => (i === 0 ? `${p.heading},${HEADING_TOLERANCE_DEG}` : '')).join(';')}` : '';
      const json = await RouteLoading.json(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson${bearings}`);
      if (!json.routes || !json.routes[0]) throw new Error(json.message || 'no route');
      return [{ coords: json.routes[0].geometry.coordinates, turns: [], timeS: Number.isFinite(json.routes[0].duration) ? json.routes[0].duration : null }];
    }
    const osrmRoute = async (points) => (await osrmRoutes(points))[0].coords;
    // Fun score of a routed track, with the router's junction turns placed on it (map only, docs/ROUTING.md).
    // scaleAt: the route engine's quality gate on each corner (route_engine.js), null for the map-only score.
    function funOf(t, turns = [], scaleAt = null) {
      const turnsM = turns.map(([lon, lat]) => { const h = Core.nearestIndex(lat, lon, t.lat, t.lon, -1); return h.distM < 40 ? t.dist[h.index] : null; });
      return FunRoute.score(t, turnsM, roadPrefs, scaleAt);
    }
    // The route engine (web/route_engine.js, docs/ROUTE_ENGINE.md): every candidate becomes a corridor, the route context
    // providers (web/route_ctx) answer for all of them at once within CTX_BUDGET_MS, and the engine ranks on road quality,
    // corners worth driving, scenery, time-dependent penalties and hard constraints. No engine, no answers or out of time:
    // exactly the old ranking (FunRoute.rank), so Where to? never waits on a slow source.
    // 4 s: the OSM, crowd, driver and car providers need more than the router does; Where to? shows the quickest at 1.5 s
    // (EARLY_MS) and never waits on this. What's late lands in each provider's cache for the next plan.
    // PLAN_CTX_MS: the stage plans' own run, once they're routed: what's late is unknown (and can't win)
    const CTX_BUDGET_MS = 4000, STAGE_CTX_MS = 1200, PLAN_CTX_MS = 1800;
    // When to go (when_to_go.js): a route may be planned for a later departure (the card's "Plan for 6:30 PM"); every
    // clock the plan reads (the sun, the forecast, school runs, timed closures) is then that hour's. null, or a time that
    // has passed: now. Starting the drive, clearing the route or Leave now puts it back.
    let leaveAtMs = null;
    const leaveAt = () => (leaveAtMs && leaveAtMs > Date.now() ? leaveAtMs : Date.now());
    // The driver's For this drive choices (route_ctx/driver.js: passenger, lit, cyclists, tunnels) join the road prefs.
    // The corner prefs our router's searches and stage lists use: yours, with a level one leaning toward your taste
    // (taste.js cornerLean, from five "which road was better?" answers on). Route scores and the card keep yours alone.
    const searchPrefs = () => {
      try {
        const t = window.ApexTaste && !(window.ApexFlags && !ApexFlags.on('taste_ranking')) ? ApexTaste.fit(ApexTaste.load(localStorage)) : null;
        const p = t ? ApexTaste.cornerLean(t, roadPrefs) : roadPrefs;
        if (window.apexDebug) window.apexDebug.lastSearchPrefs = { tight: p.tight || 0, fast: p.fast || 0 };
        return p;
      } catch (_) { return roadPrefs; }
    };
    const engineOpts = (level) => ({ level, prefs: { ...roadPrefs, ...(window.ApexRouteDriver ? ApexRouteDriver.load(localStorage) : {}) }, car: routingCar(),
      score: (c, scaleAt) => funOf(c.t, (c.route && c.route.turns) || [], scaleAt) });
    function rankPool(pool, level) {
      return window.ApexRouteEngine ? ApexRouteEngine.rank(pool, engineOpts(level)) : FunRoute.rank(pool, level);
    }
    // The route-context providers that only answer a plan are not on the launch path (web/lazy.js 'ctx'): they load once
    // the map is idle after the launch, or by the first plan that needs them. Offline website: the plan goes on with the
    // providers it has (as when one is missing), and the next plan asks again
    let ctxReady = null;
    function needCtx() {
      if (!window.ApexLazy) return Promise.resolve();
      if (!ctxReady) ctxReady = ApexLazy.load('ctx').catch((e) => { ctxReady = null; console.error('ctx', e); });
      return ctxReady;
    }
    async function contextOn(cands, budgetMs = CTX_BUDGET_MS, prefix = 'cand', only = null, extra = null, skip = null) {
      await needCtx();
      if (!window.ApexRouteEngine || !window.ApexRouteCtx || !cands.length || (window.ApexFlags && !ApexFlags.on('route_engine'))) return null;
      const departAt = state.mode === 'live' ? Date.now() : leaveAt(), car = routingCar(), pace = state.mode === 'live' && etaPace.factors ? etaPace.factors.open : null;
      const list = cands.filter((c) => (c.corridor = ApexRouteEngine.corridorFor(c, `${prefix}${cands.indexOf(c)}`, { departAt, car, pace })));
      for (const c of list) if (c.match) c.corridor.match = c.match;     // a loop's spur-cut line isn't the router's own: snap it
      for (const c of list) if (c.route && c.route.graph) c.corridor.graph = c.route.graph;   // ours: the tiles' scores per edge (route_ctx/graph.js)
      try {
        const at = typeof performance !== 'undefined' ? performance.now() : 0;
        const res = await ApexRouteCtx.run(list.map((c) => c.corridor), { budgetMs, ...(only ? { only } : {}), ...(skip ? { skip } : {}), settings: routeCtxSettings(), providerOpts: { ...routeCtxOpts(), ...(extra || {}) } });
        for (const c of list) { c.ctx = res.byId[c.corridor.id] || null; c.ev = null; }
        if (window.apexDebug) window.apexDebug.lastCtx = res.status;
        if (typeof tlSpan === 'function' && at) { tlSpan(`context ${prefix}`, at); for (const [k, v] of Object.entries(res.status || {})) if (v && v.ms) tlSpan(`context ${prefix}: ${k} ${v.status}`, at, at + v.ms); }
        return res;
      } catch (_) { return null; }
    }
    // The network step: the stages worth asking about get the context too (router edges, terrain), so a curvy subdivision
    // street falls behind a real back road before any connector is timed. Any failure: the map's order, as before.
    async function stagesWithContext(stages, k = 8, only = null) {
      await needCtx();
      if (!window.ApexRouteEngine || !window.ApexRouteCtx || !stages || !stages.length || (window.ApexFlags && !ApexFlags.on('route_engine'))) return stages;
      try {
        const cs = ApexRouteEngine.stageCorridors(stages, k, { departAt: leaveAt(), car: routingCar() });
        const res = await ApexRouteCtx.run(cs, { budgetMs: STAGE_CTX_MS, stage: true, ...(only ? { only } : {}), settings: routeCtxSettings(), providerOpts: routeCtxOpts() });
        return [...ApexRouteEngine.rescoreStages(stages.slice(0, k), res.byId), ...stages.slice(k)];
      } catch (_) { return stages; }
    }
    // Keys a provider may need (docs/OWNER_TODO.md lists them); none of them is required, a missing one is 'no-key'.
    function routeCtxSettings() {
      try { return JSON.parse(localStorage.getItem('apex.routeKeys') || '{}') || {}; } catch (_) { return {}; }
    }
    // What the crowd and car providers need from the app (route_ctx/crowd.js, car.js): members' road data (/api/roads?cells=,
    // signed out: null and they say so), the Worker for chargers, the crews' shared lines when Prefer has them, your taste
    // fit. `peer` is filled by the registry with the first phase's channels (the grid's mobile_coverage when a bundle has
    // it, which none does today); the engine also reads that channel itself (route_engine.js SOURCES).
    function routeCtxOpts() {
      const get = async (path) => { try { const r = await apiCall('GET', path); return r && r.ok ? await r.json() : null; } catch (_) { return null; } };
      let taste = null;
      try { taste = window.ApexTaste ? ApexTaste.fit(ApexTaste.load(localStorage)) : null; } catch (_) { taste = null; }
      // members' road data by the 0.1° cells a plan crosses (VI-1), never by the route's way ids
      // our own network's scores along any corridor (route_ctx/graph.js), from the worker that holds the tiles
      const graphScore = ownClient ? (lines) => ownClient.score(lines) : undefined;
      // With no signal (or the server down) the cells kept on the phone stand in, all of them or none (own_routing.js
      // keptFor): a day's keep, or for good in a saved offline area (IDEAS F-02). A server that says no (signed out) is final.
      const lookupCells = window.ApexSync ? async (cells) => {
        let r = null;
        try { r = await apiCall('GET', `/api/roads?cells=${cells.join(',')}`); } catch (_) { r = null; }
        if (r && r.ok) { try { return await r.json(); } catch (_) { return null; } }
        if (r && r.status < 500) return null;
        return window.ApexOwnRouting && ApexOwnRouting.keptFor ? ApexOwnRouting.keptFor(cells) : null;
      } : undefined;
      return { lookupCells, apiGet: get, graphScore,
        crewLines: (typeof preferCache !== 'undefined' && preferCache.crewLines) || null, myTracks: null, taste, peer: {},
        osmRelay: !!(window.ApexFlags && ApexFlags.on('osm_relay', false)) };   // the OSM relay: off unless the server says on
    }
    // After a route is chosen (route_ctx/car.js): a car with no range meeting a long stretch without fuel is asked for it once;
    // stretches without signal offer to save their maps, then to share the ETA before the signal goes.
    function routeAftercare(c) {
      if (!c || !c.ctx || !window.ApexRouteCar) return;
      const pts = c.ctx.points || [], spans = c.ctx.spans || [];
      const ask = pts.find((p) => p.kind === 'ask_range');
      if (ask) { toast(ask.label, { label: 'Garage', ms: 8000, onClick: () => showView('garage') }); return; }
      const share = pts.some((p) => p.kind === 'share_eta') && !etaShare.token;
      const offerShare = () => { if (share) toast('No signal later on this route. Share your ETA now?', { label: 'Share ETA', ms: 8000, onClick: () => $('etaShareBtn').click() }); };
      const areas = c.corridor ? ApexRouteCar.offlineAreas(c.corridor, spans) : [];
      if (!areas.length) { offerShare(); return; }
      toast(`No signal on ${areas.length === 1 ? 'part' : 'parts'} of this route. Save the maps there?`, { label: 'Save', ms: 8000, onClick: async () => {
        const n = await ApexRouteCar.prepareOffline(areas, { styleUrl: MAP_STYLE });
        toast(n ? `Saved the maps for ${n} stretch${n === 1 ? '' : 'es'} without signal.` : 'Couldn\'t save the maps. Try again with signal.');
        setTimeout(offerShare, 4500);
      } });
    }
    // OSM maxspeed per sample via Valhalla map matching (same as tools/export_web_profile.py).
    async function attachLimits(t) {
      // ours: the posted limits from the tiles the route was planned on (OWN_ROUTING.md §5), offline too and without
      // Valhalla; an edge the tiles have no posted limit for stays null (an unposted road, as map matching would say)
      // (in a task of its own, after the card has painted)
      const own = ownRouteOfTrack.get(t);
      if (own && t.limitSource !== 'tiles') {
        await new Promise((r) => setTimeout(r, 0));
        let limits = null;
        try { limits = ApexOwnRouting.limitsAlong(t.lat, t.lon, own); } catch (_) { limits = null; }
        if (limits) {
          t.limitMps = limits; t.limitSource = 'tiles';
          if (timeFromEnvelope(t) && plannedRoute === t) renderRouteCard(t);
          if (track === t) render(false);
          return;
        }
      }
      if (t && t.limitSource === 'tiles') return;
      const stride = 4, idx = [];
      for (let i = 0; i < t.lat.length; i += stride) idx.push(i);
      if (idx[idx.length - 1] !== t.lat.length - 1) idx.push(t.lat.length - 1);
      try {
        const json = await RouteLoading.json(`${VALHALLA}/trace_attributes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          shape: idx.map(i => ({ lat: t.lat[i], lon: t.lon[i] })), costing: 'auto', shape_match: 'map_snap',
          filters: { attributes: ['edge.speed_limit', 'matched.edge_index'], action: 'include' } }) });
        const edges = json.edges || [];
        t.limitMps = new Array(t.lat.length).fill(null);
        (json.matched_points || []).forEach((mp, k) => {
          const e = edges[mp.edge_index];
          const v = e && typeof e.speed_limit === 'number' ? e.speed_limit / 3.6 : null;
          for (let i = idx[k]; i < (idx[k + 1] ?? t.lat.length); i++) t.limitMps[i] = v;
        });
        if (timeFromEnvelope(t) && plannedRoute === t) renderRouteCard(t);   // U-64: the limits cap the envelope's time
        if (track === t) render(false);
      } catch (_) { /* unknown stays unknown */ }
    }
    function here() {
      if (state.live) return { lat: state.live.lat, lon: state.live.lon };
      if (track) { const s = sample(track, state.cursorM); return { lat: s.lat, lon: s.lon }; }
      const c = map.getCenter(); return { lat: c.lat, lon: c.lng };
    }
    // Route planning starts from the phone's real position: the live fix while driving, else one
    // GPS fix. Never the map centre: a route from the wrong start is worse than none.
    const IN_APP_SHELL = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex);
    function locate() {
      if (state.live) return Promise.resolve({ lat: state.live.lat, lon: state.live.lon });
      if (IN_APP_SHELL) {
        return new Promise((resolve) => {
          const fresh = () => state.lastPosition && performance.now() - (state.lastPositionAt || 0) < 30000;
          if (fresh()) { resolve(state.lastPosition); return; }
          const t0 = performance.now(), poll = setInterval(() => {
            if (fresh()) { clearInterval(poll); resolve(state.lastPosition); }
            else if (performance.now() - t0 > 10000) { clearInterval(poll); resolve(null); }
          }, 200);
        });
      }
      // the web: the idle map's watchPosition keeps lastPosition fresh; a fix under 10 s old is used as it is (asking again
      // cost a plan 0.2-0.5 s, live 2026-11-05: the second plan's first route came up later than the first's)
      if (state.lastPosition && performance.now() - (state.lastPositionAt || 0) < 10000) return Promise.resolve(state.lastPosition);
      return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          (p) => { state.lastPosition = { lat: p.coords.latitude, lon: p.coords.longitude }; state.lastPositionAt = performance.now(); refreshAutoNight(); resolve(state.lastPosition); },
          () => resolve(state.lastPosition || null),               // no fresh fix: the last one known (a re-plan's start), else none
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
      });
    }
    const NO_FIX = 'Couldn\'t get your location. Type a start or tap the map.';
    let plannedRoute = null;
    // Avoid towns (R-15): km of each candidate near a city, town or village (FunRoute.townKm), which ranking then costs.
    // Only when the driver asked; unknown (no tiles) stays unknown and costs nothing.
    // (ms: the card waits that long for the map's place tiles, 0.4 s; the refine after it, longer)
    async function townsOn(tracks, cands, ms = 400) {
      if (!avoid.towns || !tracks.length) return;
      const pts = [];
      for (const t of tracks) for (let i = 0, next = 0; i < t.lat.length; i++) if (t.dist[i] >= next) { pts.push({ lat: t.lat[i], lon: t.lon[i] }); next = t.dist[i] + 1000; }
      let places = null;
      // (the map's place tiles: on a weak signal the card waited for them; ms, then unknown, and what lands is kept for
      // the next plan: stages.js placeTiles)
      try {
        const asked = Promise.resolve().then(() => ApexStages.places(pts));
        asked.catch(() => {});
        let timer;
        places = await Promise.race([asked, new Promise((r) => { timer = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(timer));
      } catch (_) { /* no tiles, or a trip too big: unknown (the card says so) */ }
      cands.forEach((c, i) => { c.townKm = places ? FunRoute.townKm(tracks[i], places) : null; });
    }
    const fewerTownKm = (c, quick) => (c && quick && Number.isFinite(c.townKm) && Number.isFinite(quick.townKm) ? quick.townKm - c.townKm : 0);
    // Route options of the last fun plan: { id, name, request, level, quickest, list (ranked candidates), picked, current (its track) }.
    let routeOptions = null;
    // The Explore list while it is up (R-10): { here, minutes, picks: [{ s, fwd, awayS }] }.
    let explore = null;
    function normRoadType(type) {
      return type === 'Flowing sweepers' ? 'Sweepers' : type === 'Fast open' ? 'Fast & open' : (type || '--');
    }
    function roadTypeOf(t) {
      if (t && t.archetype) return normRoadType(t.archetype);
      if (!t || !Array.isArray(t.sectors) || !t.sectors.length) return '--';
      const spirited = t.sectors.filter(s => s && s.archetype && s.archetype !== 'Connector' && s.archetype !== 'Town');
      const pool = spirited.length ? spirited : t.sectors.filter(s => s && s.archetype);
      if (!pool.length) return '--';
      const counts = new Map();
      for (const s of pool) counts.set(s.archetype, (counts.get(s.archetype) || 0) + 1);
      return normRoadType([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    }
    // "Why this route" from FunRoute.why: the roads the detour is for and what it costs (null = say nothing).
    // fewerKm: km less in towns than the quickest (Avoid towns), when that is part of why; extraS: the minutes it costs.
    function whyText(w, fewerKm = 0, extraS = 0) {
      const fewer = fewerKm >= 1;
      if (!w && !(fewer && extraS >= 60)) return null;
      const mi = (km) => ApexUnits.long(km * 1000, 1, true);
      const roads = w ? w.roads.map(r => `${r.name} ${mi(r.km)}`).join(', ') : '';
      const gain = w && w.gained ? `${w.gained} more good corner${w.gained === 1 ? '' : 's'}` : '';
      const towns = fewer ? `${mi(fewerKm)} less in towns` : '';
      const extraMin = w ? w.extraMin : Math.round(extraS / 60);
      return `For ${[roads, gain, towns].filter(Boolean).join(' · ')}${extraMin >= 1 ? `, +${extraMin} min` : ''}`;
    }
    // A route's drive time: "42 min", "1 h 05" from the hour; null when unknown.
    const routeTimeText = (s) => (!Number.isFinite(s) ? null : s < 3570 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(Math.round(s / 60) / 60)} h ${String(Math.round(s / 60) % 60).padStart(2, '0')}`);
    // U-101: the name whole: 16 px, then down a pixel at a time to 14 px while it does not fit on one line; a name longer
    // still takes two lines at 14 px (the bar grows a little) rather than an ellipsis. Measured once the bar is laid out, and
    // again when the width changes (a turn of the phone).
    function fitRouteBarName() {
      const b = $('routeBarName'), bar = $('routeBar');
      b.style.fontSize = ''; bar.classList.remove('two');
      requestAnimationFrame(() => {
        if (!b.clientWidth) return;
        // (design pass, 2026-11-10: the name is the card's headline, so the steps start from its own size, down a fifth)
        const base = Math.round(parseFloat(getComputedStyle(b).fontSize)) || 16, floor = Math.max(14, Math.round(base * 0.8));
        for (let px = base - 1; px >= floor && b.scrollWidth > b.clientWidth + 1; px--) b.style.fontSize = `${px}px`;
        if (b.scrollWidth > b.clientWidth + 1) bar.classList.add('two');
      });
    }
    window.addEventListener('resize', () => { if ($('planPanel').classList.contains('routed')) fitRouteBarName(); });
    // U-114: the bar's width changes after the name is set (the card goes down and the Start key takes its place; the
    // theme's font arrives late), so the name is fitted again whenever the bar's own width changes, and once fonts are in.
    {
      let barW = 0;
      if (window.ResizeObserver) new ResizeObserver(() => { const w = $('routeBar').clientWidth; if (w && w !== barW) { barW = w; if ($('planPanel').classList.contains('routed')) fitRouteBarName(); } }).observe($('routeBar'));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if ($('planPanel').classList.contains('routed')) fitRouteBarName(); }).catch(() => {});
    }
    // finding 9: the card's dials in plain words (vocabulary.js twist / flow), the road's kinds too (ROAD_WORDS)
    const VOC = window.ApexVocabulary || null;
    const TWIST_WORD = VOC ? VOC.TERMS.twist.label : 'Curvy', FLOW_WORD = VOC ? VOC.TERMS.flow.label : 'Flowing';
    const isLoop = (t) => !!t && typeof t.id === 'string' && t.id.startsWith('loop_');
    // The card's hero (design pass, 2026-11-10): the route's profile, its corners ticked along the foot, and the red apex dot
    // where you are on it (the start, or where the fly-through was left). Before the heights are in, and when they never
    // come, the road is a level line with its corners (route_card.js strip): the graphic is never an empty box, and the
    // heights stay "--". Drawn at the box's own width so the highest point's label keeps its shape. A profile that is new
    // on the card (a route found, its heights arriving) is drawn on from the left, in step with the line on the map.
    const PROFILE_H = 80;
    const profileDrawn = new WeakMap();                                // route -> { kind, at, ms }: the stroke under way
    function paintProfile(t) {
      const box = $('routeCardProfile'), w = Math.max(240, Math.round(box.clientWidth) || 340);
      const full = ApexRouteCard.profile(t, w, PROFILE_H, heightLabel), svg = full || ApexRouteCard.strip(t, w, PROFILE_H) || '';
      box.innerHTML = svg + (svg ? '<i class="rc-here" id="routeCardHere" aria-hidden="true"></i>' : '');
      box.classList.toggle('none', !full && !!t.profileDone);
      box.classList.toggle('flat', !full);
      box.dataset.w = String(w);
      paintHere(t);
      const el = box.firstElementChild, kind = full ? 'elev' : 'strip', now = performance.now();
      if (!el || !svg) return;
      let d = profileDrawn.get(t);
      if (!d || d.kind !== kind) {
        const r = cardReveal && cardReveal.t === t ? cardReveal : null;
        // heights that arrive later draw themselves on; a swap's are quick; a cut when nothing is to be animated
        const ms = !r || !(r.ms > 0) ? 0 : kind === 'strip' || now - r.at < 250 ? r.ms : Math.max(r.ms, 600);
        d = { kind, at: now, ms }; profileDrawn.set(t, d);
      }
      const left = d.ms - (now - d.at);
      if (left > 30) { el.style.setProperty('--rc-draw', `${d.ms}ms`); el.style.animationDelay = `${-(now - d.at)}ms`; el.classList.add('draw'); }
    }
    // the apex dot on the profile: where the cursor is along the route (0 at rest; the fly-through moves it)
    function paintHere(t = plannedRoute) {
      const dot = $('routeCardHere'), box = $('routeCardProfile');
      if (!dot || !t || !window.ApexRouteCard) return;
      const at = ApexRouteCard.profileAt(t, track === t ? state.cursorM : 0, +box.dataset.w || 340, PROFILE_H);
      dot.hidden = !at;
      if (at) { dot.style.left = `${(at.fx * 100).toFixed(2)}%`; dot.style.top = `${(at.fy * 100).toFixed(2)}%`; }
    }
    function renderRouteCard(t = plannedRoute) {
      const card = $('routeCard');
      // the card takes the plan sheet's place: it opens at its headline, wherever the sheet had been scrolled to
      if (t && !$('planPanel').classList.contains('routed')) $('planBody').scrollTop = 0;
      $('planPanel').classList.toggle('routed', !!t);
      $('app').classList.toggle('routed', !!t);
      // finding 8: one name for go. The bar's key starts the planned route (Start, red); with none it's the smaller Just drive
      { const k = $('startDrive'), label = t ? 'Start' : 'Just drive';
        if (k.lastChild && k.lastChild.nodeType === 3 && k.lastChild.textContent !== label) k.lastChild.textContent = label;
        k.setAttribute('aria-label', t ? `Start: drive ${t.name || 'the route'}` : 'Just drive: record a drive with no route'); }
      if (t) {
        const mi = Array.isArray(t.dist) && t.dist.length ? `${ApexUnits.long(t.dist[t.dist.length - 1], 1)}` : '--';
        $('routeBarName').textContent = t.name || 'Route';
        fitRouteBarName();
        // U-64: the time too, the router's or the route's own envelope (timeFromEnvelope), in the card's order: "1 h 05 · 35.4 mi · 32 corners"
        // (the numbers in ink, their units in pencil, as the card's stat line sets them)
        $('routeBarMeta').replaceChildren(...[routeTimeText(t.timeS), mi, Array.isArray(t.events) ? ApexFormat.cornerCount(t.events.filter(e => e.type === 'corner').length) : ''].filter(Boolean)
          .flatMap((part, k) => { const m = /^([\d.,:]+(?: h \d\d)?)(.*)$/.exec(part), n = document.createElement('i'); if (m) n.textContent = m[1]; return [k ? ' · ' : '', ...(m ? [n, m[2]] : [part])]; }));
      }
      carRoute(t);
      if (!t) { card.hidden = true; paintAlternates(); return; }
      plannedRoute = t;
      card.hidden = false;
      $('routeCardName').textContent = t.name || '--';
      // planned with Route tuning's sliders moved: says so (and which), so a surprising route is explainable; a tap opens them
      { const k = $('cardTuneChip'), on = Array.isArray(t.tuned) && t.tuned.length > 0;
        if (k) { k.hidden = !on; k.title = on ? `Planned with your route tuning: ${t.tuned.join(', ')}` : ''; k.setAttribute('aria-label', on ? `Your tuning: ${t.tuned.join(', ')}. Open Route tuning` : 'Your tuning'); } }
      const hasDist = Array.isArray(t.dist) && t.dist.length > 0 && Number.isFinite(t.dist[t.dist.length - 1]);
      const mi = hasDist ? `${ApexUnits.long(t.dist[t.dist.length - 1], 1)}` : '--';
      const corners = Array.isArray(t.events) ? ApexFormat.cornerCount(t.events.filter(e => e.type === 'corner').length) : '--';   // "1 corner", never "1 corners"
      const min = routeTimeText(t.timeS);
      const extra = Number.isFinite(t.extraS) && t.extraS >= 60 ? ` (+${Math.round(t.extraS / 60)} for fun)` : '';
      $('routeCardMeta').textContent = [mi, min && min + extra, corners, roadTypeOf(t)].filter(v => v && v !== '--').join(' · ');
      // the card as instruments (REVIEW.md roadmap 5): three stamped numbers and the profile with a tick per corner
      $('routeCardStats').innerHTML = ApexRouteCard.stats(t, (m) => ApexUnits.long(m, 1)).map((x) =>
        `<div><b>${x.value}${x.unit ? `<small>${x.unit}</small>` : ''}</b><span>${x.label}</span></div>`).join('');
      // the reveal: the three numbers count up to what they say, once, for a route just found (never for a redraw)
      if (cardReveal && cardReveal.t === t && cardReveal.countMs > 0 && !cardReveal.counted && window.ApexReveal) {
        cardReveal.counted = true;
        ApexReveal.countUp($('routeCardStats').querySelectorAll('b'), cardReveal.countMs);
      }
      // finding 2: the profile's room is kept until its heights are in (or known not to come), so nothing under it jumps
      paintProfile(t);
      const avgSector = (k) => {
        if (!Array.isArray(t.sectors) || !t.sectors.length) return null;
        const vals = t.sectors.map(s => s && s[k]).filter(Number.isFinite);
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      };
      // A driven road has measured sectors; a planned one has its map-only fun score (docs/ROUTING.md).
      // U-115: Twist and Flow from the track's own corners when nothing better is known (a GPX, a loop), as for a searched route
      const geo = ApexRouteCard.shape(t, (x) => FunRoute.score(x, [], roadPrefs));
      const bars = Array.isArray(t.sectors) && t.sectors.length
        ? [[TWIST_WORD, avgSector('tech') ?? geo.twist], [FLOW_WORD, avgSector('flow') ?? geo.flow], ['Surface', avgSector('surf')]]
        : [[TWIST_WORD, geo.twist], [FLOW_WORD, geo.flow],
           // Surface only once members have measured enough of it; map geometry can't know pavement.
           ...(window.ApexContributor && ApexContributor.surfaceScore(t.measured) != null ? [['Surface', ApexContributor.surfaceScore(t.measured)]] : [])];
      // small half-dials, "--" when unknown; Fun is the options' tile, so the card shows what makes it up. Surface only once
      // members have measured it; cameras once the camera check has run.
      const dials = bars.filter(([label]) => label !== 'Fun');
      if (!dials.some(([label]) => label === 'Surface')) dials.push(['Surface', null]);
      $('routeCardBars').innerHTML = dials.map(([label, v]) => ApexRouteCard.dial(label, v)).join('')
        + ApexRouteCard.count('Cameras', Array.isArray(t.alpr) ? t.alpr.length : null);
      // Plate cameras along it, only once the camera check has run (unknown stays off the card).
      const cams = '';                                              // on the Cameras dial
      const mCov = t.measured && Number.isFinite(t.measured.coverage) && t.measured.coverage > 0
        ? Math.round(t.measured.coverage * 100)
        : (Array.isArray(t.roughG) && t.roughG.length && t.roughG.some(Number.isFinite))
          ? Math.round(t.roughG.filter(Number.isFinite).length / t.roughG.length * 100)
          : null;
      const feel = mCov != null && mCov > 0 ? `Road feel ${mCov}% driven` : '';   // none measured: the dials' dashes say so, no footnote
      const missed = Array.isArray(t.unavoided) && t.unavoided.length ? `Couldn't avoid ${t.unavoided.map(k => FunRoute.AVOID_LABELS[k] || k).join(' or ')} · ` : '';
      // Avoid police reports: the live reports near this route, from the reports as they are now (they can land after the
      // plan: the card is painted again then, policeLanded); none known: nothing said
      const pol = policeOnCard(t);
      const closed = closedOnCard(t) ? 'Passes a road closure · ' : '';
      const around = pol && pol.n && !pol.passes ? `Around ${pol.n === 1 ? 'a police report' : `${pol.n} police reports`} · ` : '';
      const missedPolice = pol && pol.passes && !(t.unavoided || []).includes('police') ? 'Couldn\'t avoid police reports · ' : '';
      // Planned routes only: a driven track's own time has passed.
      const sun = !(Array.isArray(t.sectors) && t.sectors.length) && t.glareMin >= 3 ? `Low sun ahead for ~${t.glareMin} min · ` : '';
      // Only on a route planned with Towns on (townKm undefined otherwise); null = the town check couldn't run.
      const towns = t.townKm === null ? 'Couldn\'t check towns · ' : t.townKm >= 1.6 ? `Through towns ~${ApexUnits.long(t.townKm * 1000, 0)} · ` : '';
      const carLine = t.request ? FunRoute.carNote(routingCar(), avoid) : '';
      // your taste (taste.js) when it moved this route up: the word for what you lean to, never a number
      const tasteLine = (() => { try { const f = t.tasteBonus >= 1 && window.ApexTaste ? ApexTaste.fit(ApexTaste.load(localStorage)) : null;
        if (!f) return ''; const k = ApexTaste.AXES.slice().sort((a, b) => f[b] - f[a])[0]; return `Suits your taste for ${{ tech: 'technical roads', flow: 'flowing roads', smooth: 'smooth surfaces' }[k]} · `; } catch (_) { return ''; } })();
      $('routeCardSub').textContent = `${tasteLine}${carLine ? carLine + ' · ' : ''}${closed}${missed}${missedPolice}${around}${towns}${sun}${cams}${feel}`.replace(/ · $/, '');
      $('routeCardSub').hidden = !$('routeCardSub').textContent;
      $('routeCardWhy').textContent = t.why || '';
      $('routeCardWhy').hidden = !t.why;
      // There and back: a trip to a place (not a round trip already, no stop of yours on it), planned and not driving
      $('routeRoundBtn').hidden = !(t.id === 'route_dest' && t.request && !t.request.round && !t.request.via.some((v) => !v.shaping) && state.mode !== 'live');
      // finding 4: the level's one home is the card, for a destination route; a loop's card has its length (finding 6).
      // The owner, 2026-11-04: the levels are the choices, one card each with its own pick (paintLevelCards)
      // (a loop has no level: its card offers its length and which way to head, paintLoopWays)
      $('routeCardFun').hidden = t.id !== 'route_dest';
      paintCardLoop(t);
      paintLoopWays(t);
      paintStory(t);
      paintOptChips();
      paintLevelCards();
      paintAlternates();
    }
    // The planned route lives for this session only (sessionStorage): a reload after a lost map (WebGL, above) plans it
    // again from its own geometry (no router call, works offline), but opening the app, on the phone or in the car, starts
    // with no route (the owner, 2026-10-30: "it should open with no route loaded"; it used to keep it for 12 hours).
    // A route being driven is kept across a close (localStorage, ACTIVE) for ACTIVE_KEEP_MS, so a phone that killed the
    // app mid-drive comes back to it; ending the drive forgets it (the owner: "active routes, not planned ones").
    const PLANNED = 'apex.plannedRoute', ACTIVE = 'apex.activeRoute', ACTIVE_KEEP_MS = 12 * 3600_000;
    try { localStorage.removeItem(PLANNED); } catch (_) {}            // what older builds kept across launches
    const packPlanned = (t) => JSON.stringify({ ...ApexSavedRoutes.pack(t), extraS: t.extraS ?? null, savedAt: Date.now() });
    function persistPlanned(t) {
      try { sessionStorage.setItem(PLANNED, packPlanned(t)); } catch (_) { /* too big or storage off: a reload just won't bring it back */ }
      let driving = false; try { driving = driveActive; } catch (_) {}   // (declared further down)
      if (driving) persistActive(t);                                   // a reroute mid-drive replaces the kept one
    }
    function persistActive(t) {
      try { if (t && t.kind === 'route') localStorage.setItem(ACTIVE, packPlanned(t)); } catch (_) {}
    }
    function forgetActive() { try { localStorage.removeItem(ACTIVE); } catch (_) {} }
    // A packed route (planned or saved for offline) rebuilt on the phone: notes from its shape, the rest as it was kept.
    async function trackFromPacked(p) {
      const t = await trackFromPolyline(p.coords, p.id, p.name);
      const u = ApexSavedRoutes.unpack(p, t.dist);
      Object.assign(t, u, { extraS: p.extraS ?? null, unavoided: u.unavoided.filter(k => typeof k === 'string' && FunRoute.AVOID_LABELS[k]),
                            townKm: u.townKm === null || Number.isFinite(u.townKm) ? u.townKm : undefined });
      return t;
    }
    async function restorePlanned() {
      let saved = null;
      let resumed = false;
      try { saved = JSON.parse(sessionStorage.getItem(PLANNED) || 'null'); } catch (_) { saved = null; }
      if (!saved) {                                                    // a fresh launch: only a drive the app was closed in
        try { saved = JSON.parse(localStorage.getItem(ACTIVE) || 'null'); } catch (_) { saved = null; }
        if (saved && !(Number.isFinite(saved.savedAt) && Date.now() - saved.savedAt < ACTIVE_KEEP_MS)) { forgetActive(); saved = null; }
        resumed = !!saved;
      }
      if (!saved || !Array.isArray(saved.coords) || saved.coords.length < 2) return;
      if (resumed) setTimeout(() => toast(`Back on ${saved.name || 'your route'}: the drive you were on when the app closed.`), 1200);
      const t = await trackFromPacked(saved);
      // a route planned (or being planned) meanwhile stays: on a weak signal the land cover's wait put the old route back
      // over a new plan's seconds later (2026-11-08)
      if (plannedRoute || $('planPanel').classList.contains('busy')) return;
      await buildRoute(null, saved.id, saved.name, t);
    }
    // Saved for offline (IDEAS F-03): the route card's Save keeps it on the phone; Where to? lists it under Saved.
    async function openSaved(p) {
      $('destInput').value = p.name;
      await buildRoute(null, p.id, p.name, await trackFromPacked(p));
      toast(`${p.name}. Notes, directions and limits work with no signal; the map needs signal.`);
      // opened with signal (before setting off): the reports kept with it are asked again, so the dead zone gets today's
      if (plannedRoute && plannedRoute.id === p.id) keepReportsAlong(plannedRoute);
    }
    function paintSaveBtn() {
      const t = plannedRoute, b = $('routeSaveBtn');
      if (!b) return;
      const saved = !!(t && ApexSavedRoutes.has(localStorage, t.id));
      b.textContent = saved ? 'Saved' : 'Save'; b.setAttribute('aria-pressed', String(saved));
    }
    // Pin the destination (pinned_places.js, IDEAS U-20): Home, Work or any name, first in Where to?; on this phone only.
    $('routePinBtn').addEventListener('click', async () => {
      const t = plannedRoute, to = t && t.request && t.request.to;
      if (!to || !Number.isFinite(to.lat)) { toast('Plan a route to a place first.'); return; }
      const has = (n) => ApexPinnedPlaces.list(localStorage).some((p) => p.name.toLowerCase() === n);
      const name = await ApexConfirm.prompt('Pin this place as', { action: 'Pin', value: has('home') ? (has('work') ? '' : 'Work') : 'Home', placeholder: 'Home, Work or any name', maxLength: 40 });
      if (!name || !name.trim()) return;
      const label = String(t.name || '').replace(/^To /, '') || name;
      toast(ApexPinnedPlaces.pin(localStorage, name, { label, lat: to.lat, lon: to.lon }) ? `Pinned as ${name.trim()}. It's first in Where to? now.` : 'Couldn\u2019t pin that.');
      carPost(carPlaces()); itemsChanged();                              // first in the car's Places too, and on your account
    });
    $('routeSaveBtn').addEventListener('click', () => {
      const t = plannedRoute;
      if (!t || !Array.isArray(t.lat) || t.lat.length < 2) return;
      if (ApexSavedRoutes.has(localStorage, t.id)) {
        ApexSavedRoutes.remove(localStorage, t.id); toast(`${t.name} removed from saved routes.`); carPost(carPlaces()); itemsChanged();
        if (window.ApexOfflineTiles) ApexOfflineTiles.removeArea(routeAreaId(t)).catch(() => {});   // and the map kept along it
        if (window.ApexRouteReports) ApexRouteReports.remove(localStorage, String(t.id));            // and its reports
        if (window.ApexRouteFeel) ApexRouteFeel.remove(localStorage, String(t.id));                  // and its road feel
      } else if (ApexSavedRoutes.save(localStorage, ApexSavedRoutes.pack(t)) === 'saved') { toast(`Saved for offline: ${t.name}. It's listed in Where to? now.`); keepMapAlong(t); keepReportsAlong(t); keepFeelAlong(t); carPost(carPlaces()); itemsChanged(); }
      else toast('The phone is out of room for saved routes. Remove one first.');
      paintSaveBtn();
    });
    // IDEAS F-03: a saved route keeps the map along it too (offline_tiles.js planAlong: the map and terrain within 1.5 km of
    // it), so it draws with no signal on the way. Quietly, with signal; it shows in Your data as a map area and goes when the
    // route is unsaved. Nothing kept (no signal, a route too long) leaves the saved route as it was.
    const routeAreaId = (t) => `route_${String(t.id).replace(/[^\w-]/g, '').slice(0, 60)}`;
    // a map only partly kept (the phone ran out of room, or the signal went mid-save) says so, and why, rather than pass as whole
    const partKept = (a) => {
      const share = window.ApexOfflineTiles && ApexOfflineTiles.keptShare ? ApexOfflineTiles.keptShare(a) : 1;
      return share < 1 ? `${Math.min(99, Math.floor(share * 100))}% kept, ${a.full ? 'the phone is out of room' : 'the signal dropped'}` : null;
    };
    async function keepMapAlong(t, quiet = false) {
      if (!window.ApexOfflineTiles || navigator.onLine === false || !t || !Array.isArray(t.lat)) return;
      try {
        const mid = Math.floor(t.lat.length / 2);
        const a = await ApexOfflineTiles.download({ lat: t.lat[mid], lon: t.lon[mid], along: { lat: t.lat, lon: t.lon }, id: routeAreaId(t), styleUrl: MAP_STYLE, name: `Along ${t.name}` });
        if (!ApexSavedRoutes.has(localStorage, t.id)) { await ApexOfflineTiles.removeArea(a.id); return; }   // unsaved meanwhile
        const part = partKept(a);
        if (part && !quiet) toast(`The map along ${t.name}: only ${part}. Update it in Settings, Your data.`);
        else if (!quiet) toast(`The map along ${t.name} is kept for no signal too, ${Math.max(1, Math.round(a.bytes / 1048576))} MB.`);
        if (window.apexDebug) window.apexDebug.mapAlong = a;
      } catch (_) { /* the saved route stands without its map */ }
    }
    // U-64: no router time (a GPX track, a loop or a fallback router without one): the route's own envelope, capped by the
    // posted limits once attachLimits has them (eta.js envelopeTime). A forecast like the router's; timeFrom says whose.
    function timeFromEnvelope(t) {
      if (!t || t.kind !== 'route' || (Number.isFinite(t.timeS) && t.timeFrom !== 'envelope')) return false;
      const e = ApexEta.envelopeTime(t.dist, t.envMps, t.limitMps);
      if (!e) return false;
      Object.assign(t, { timeS: e.timeS, timeMarks: e.marks, timeFrom: 'envelope' });
      return true;
    }
    async function buildRoute(points, id, name, prebuilt = null, request = null) {
      let t = prebuilt;
      if (!t) {
        toast(`Finding roads to ${name}…`);
        let r = null;
        try { [r] = await routePoints(points, { osrm: true }); } catch (err) { toast('Couldn\'t build the route. Check signal and try again.'); return; }
        t = await trackFromPolyline(r.coords, id, name);
        Object.assign(t, { request, fun: funOf(t, r.turns), timeS: r.timeS, timeMarks: timeMarksOf(t, r), steps: stepsOf(t, r), unavoided: FunRoute.unavoided(avoid, r) });
        ownInstructLater(t, r);
      }
      timeFromEnvelope(t);
      if (explore) showExplore(null);                               // a route is up: the explore list has done its job
      if (t.request) for (const v of t.request.via) v.distM = t.dist[Core.nearestIndex(v.lat, v.lon, t.lat, t.lon, -1).index];
      const i = drives.findIndex(d => d.id === id);
      if (i >= 0) drives.splice(i, 1);
      drives.unshift(t);
      plannedRoute = t;
      activate(t, 0, { quiet: state.mode !== 'live', seamless: state.mode === 'live' });
      renderRouteCard(t);
      persistPlanned(t); paintSaveBtn(); paintEtaShareBtn(); paintHomeBy();
      // U-70: a route or loop that comes back opens its card (the instruments, with Drive it on them), not a one-line bar;
      // a route restored at launch, or one rebuilt during a drive, keeps the sheet down
      openPlan(state.mode !== 'live' && !booting);
      markDestination(t);
      if (state.mode !== 'live' && !booting) lockOnDestination(t);
      attachLimits(t);
      attachScenic(t);
      attachProfile(t);
      attachCharacter(t);
      paintStops(t);
      attachWeather(t);
      attachClosures(t);
      if (typeof attachWhen === 'function') attachWhen(t);        // (tests evaluate buildRoute on its own)
      if (typeof attachMarksSoon === 'function') attachMarksSoon(t);   // road marks also for a route rebuilt mid-drive
      // the route bar shows this; screen readers hear it (REVIEW.md: the bar is the toast)
      if (!prebuilt) announce(`${name} · ${ApexUnits.long(totalM(), 1)} · ${((n) => `${n} corner${n === 1 ? '' : 's'}`)(t.events.filter(e => e.type === 'corner').length)}`);
    }
    // A route just found: pin its destination and show it, so you can check you are routing to the right place. FOLLOW
    // (or Start drive) goes back to your position. A loop has no destination: show the whole loop instead.
    let destMarker = null;
    function markDestination(t) {
      if (destMarker) { destMarker.remove(); destMarker = null; }
      if (!t || !Array.isArray(t.lat) || !t.lat.length) return null;
      const to = t.request && t.request.to ? t.request.to : { lat: t.lat[t.lat.length - 1], lon: t.lon[t.lon.length - 1] };
      // a loop ends where it starts: no pin, or it sits on the car's arrow for the whole drive (the owner's photo, 2026-10-30)
      const n = t.lat.length - 1, c = Math.cos(t.lat[0] * Math.PI / 180);
      if (Math.hypot((t.lon[n] - t.lon[0]) * 111320 * c, (t.lat[n] - t.lat[0]) * 110540) < 300) return null;
      const el = document.createElement('div'); el.className = 'dropped-pin'; el.setAttribute('aria-label', 'Destination');
      destMarker = new maplibregl.Marker({ element: el }).setLngLat([to.lon, to.lat]).addTo(map);
      return to;
    }
    function lockOnDestination(t) {
      fitPlannedRoute(t, true);
    }
    // DA-2 (panel round 2; round 1's D-5): the chosen route stays whole on screen. It used to fly to the destination at street
    // zoom (planning/phone/004: 300 m of red line by a school), and that flight left its padding (the card's height) on the
    // map; MapLibre adds the map's padding to a fit's, so the fit when the card went down had no room and gave up
    // (planning/phone/006: the car at the top edge, the route off the screen). Now every fit clears the padding first and
    // frames the whole route and the car: above the open card when it leaves a strip to see the route in (U-70), else above
    // the bar (on its side, or the desk's column, the card covers the map: the fit is for when it goes down).
    // The app's own move: follow pauses without the recenter key, which a drag of the map brings up (U-71, U-122).
    // The map the open sheet covers from the left when it is a column beside the map (a phone in landscape with a route
    // planned, the desk's Where to?), in px of the map; 0 when it lies across the map's foot (2026-11-13)
    function sideCover() {
      const panel = $('planPanel');
      if (!panel.classList.contains('open')) return 0;
      const r = panel.getBoundingClientRect(), m = map.getContainer().getBoundingClientRect();
      return r.width > 0 && r.width < m.width * 0.7 && r.left <= m.left + 24 && r.right > m.left ? Math.round(r.right - m.left) : 0;
    }
    function routeBottom(aboveCard) {
      if (sideCover()) return viewInsets().b + 24;                   // the card is beside the route, not under it
      const sv = viewInsets(), panel = $('planPanel'), mapH = (map.getContainer().clientHeight - sv.t - sv.b) || window.innerHeight;   // F-02: the map you can see, not its full-bleed box
      const desk = matchMedia('(min-width: 1100px) and (min-height: 600px)').matches;
      const overCard = aboveCard && panel.classList.contains('open') && !desk && mapH - panel.offsetHeight >= 120;
      return sv.b + (overCard ? panel.offsetHeight + 16 : ($('planBar').offsetHeight || 60) + 24);
    }
    // [[w, s], [e, n]] fitted into the map the chrome leaves, `bottom` px kept clear: the map's own padding cleared first
    function fitInView(bounds, bottom, duration = 800) {
      const sv = viewInsets();
      map.stop();
      map.jumpTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 } });
      map.fitBounds(bounds, { padding: { top: sv.t + 60, left: Math.max(sv.l, sideCover()) + 40, right: sv.r + 60, bottom }, pitch: 0, bearing: 0, duration, maxZoom: 16 });
    }
    function fitPlannedRoute(t = plannedRoute, aboveCard = false) {
      if (!t || !Array.isArray(t.lat) || t.lat.length < 2 || state.mode === 'live') return;
      let w = 180, e = -180, so = 90, n = -90;
      const add = (la, lo) => { if (!Number.isFinite(la) || !Number.isFinite(lo)) return; w = Math.min(w, lo); e = Math.max(e, lo); so = Math.min(so, la); n = Math.max(n, la); };
      const step = Math.max(1, Math.floor(t.lat.length / 400));
      for (let i = 0; i < t.lat.length; i += step) add(t.lat[i], t.lon[i]);
      add(t.lat[t.lat.length - 1], t.lon[t.lon.length - 1]);
      if (vehicle) add(vehicle.lat, vehicle.lon);
      if (!(e >= w && n >= so)) return;
      holdFollow();
      const bottom = routeBottom(aboveCard);
      fitInView([[w, so], [e, n]], bottom);
      cardFit = aboveCard ? { t, at: performance.now(), bottom } : null;
    }
    // The card a route opens is still filling in when the route is fitted above it (a loop's card was 469 px tall at the fit
    // and 310 px a moment later: the loop sat in a strip at the top of the map, its start under the masthead). While the card
    // settles, a change in its height fits the route again, unless you have moved the map since.
    let cardFit = null;
    map.on('dragstart', () => { cardFit = null; });
    map.on('zoomstart', (ev) => { if (ev.originalEvent) cardFit = null; });
    if (window.ResizeObserver) new ResizeObserver(() => {
      if (!cardFit || performance.now() - cardFit.at > 4000 || cardFit.t !== plannedRoute || state.mode === 'live') return;
      const { t, at } = cardFit;
      if (Math.abs(routeBottom(true) - cardFit.bottom) < 24) return;
      fitPlannedRoute(t, true);
      if (cardFit) cardFit.at = at;                                  // the window runs from the first fit, not each refit
    }).observe($('planPanel'));
    // Plan fields: empty = the phone's position (locate()), "lat, lon" = that point, anything else =
    // the first Nominatim match. Errors carry the toast text.
    const COORDS = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
    // A place pinned or tapped on the map is in its field by name (the road's, when the lookup knew it; else "Dropped
    // pin"), never as coordinates (2026-11-10). The exact point rides beside the field and holds while its text is unchanged.
    const PIN_WORD = 'Dropped pin', fieldPin = {};
    function setFieldPin(field, p, name) {
      const text = name && name !== '--' ? name : PIN_WORD;
      fieldPin[field] = { text, lat: p.lat, lon: p.lon };
      $(field).value = text;
    }
    const pinIn = (field, q) => { const pin = fieldPin[field]; return pin && pin.text === String(q || '').trim() ? pin : null; };
    const toName = (label) => (label === PIN_WORD ? 'To a dropped pin' : `To ${label}`);
    const fromToName = (name) => { const l = String(name || '').replace(/^To /, ''); return l === 'a dropped pin' ? PIN_WORD : l; };
    async function resolvePlace(q, field) {
      const pin = field && pinIn(field, q);
      if (pin) return { lat: pin.lat, lon: pin.lon, label: pin.text, routeName: toName(pin.text) };
      if (!q.trim()) {
        const p = await locate();
        if (!p) throw new Error(NO_FIX);
        return { lat: p.lat, lon: p.lon, label: null };
      }
      const m = q.match(COORDS);
      if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]), label: `Pin ${parseFloat(m[1]).toFixed(3)}, ${parseFloat(m[2]).toFixed(3)}` };
      let items;
      try { items = await RouteLoading.json(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {}, 10000); }
      catch (_) {
        // no signal: the nearest match on the map kept on the phone (mapSuggest), else the map is the way
        const kept = await mapSuggest(q).catch(() => []);
        if (kept.length) return { lat: kept[0].lat, lon: kept[0].lon, label: kept[0].label };
        throw new Error('Search is offline. Tap the map instead.');
      }
      if (!items.length) throw new Error(`No match for "${q}"`);
      return { lat: parseFloat(items[0].lat), lon: parseFloat(items[0].lon), label: items[0].display_name.split(',')[0] };
    }
    // Routes from elsewhere (IDEAS R-25, R-26; web/route_import.js): a Google/Apple Maps link pasted into Where to?, or a GPX
    // file (Open GPX, or "Open in Vetta" from Files and Mail in the app). A GPX track is followed as drawn; route points,
    // waypoints and a link's stops are routed through in order.
    async function openMapsLink(link) {
      if (link.short) { toast('Open that link in your browser first, then copy the full address from there.'); return; }
      const ui = planBusy();
      ui.step('Finding…', 0.3);
      try {
        const where = (p) => (p && p.query ? resolvePlace(p.query) : Promise.resolve(p ? { lat: p.lat, lon: p.lon, label: null } : null));
        const from = link.from ? await where(link.from) : await resolvePlace('');
        const to = await where(link.to), via = [];
        for (const v of link.via || []) via.push(await where(v));
        const name = `To ${to.label || 'the shared place'}`;
        ui.step('Routing…', 0.7);
        if (via.length) await buildRoute([from, ...via, to].map((p) => ({ lat: p.lat, lon: p.lon })), 'route_link', name);
        else await funRoute(from, to, 'route_dest', name, { from: link.from ? { lat: from.lat, lon: from.lon } : null, to: { lat: to.lat, lon: to.lon }, via: [] }, ui);
      } catch (err) { toast(errText(err)); } finally { ui.done(); }
    }
    async function openGpx(text, fileName) {
      const g = ApexRouteImport.parseGpx(text);
      if (!g) { toast('That file has no route or track in it.'); return; }
      const name = g.name || (fileName || 'GPX route').replace(/\.gpx$/i, '');
      if (g.kind === 'track') {
        const t = await trackFromPolyline(g.coords, `gpx_${Date.now()}`, name);
        await buildRoute(null, t.id, name, t);
        toast(`${name}: following the track as drawn, ${ApexUnits.long(totalM(), 1)}.`);
      } else await buildRoute(g.stops, `gpx_${Date.now()}`, name);
    }
    $('gpxFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (f.size > 5e6) { toast('That file is too big for a route (5 MB at most).'); return; }
      closeOptions(true);
      openGpx(await f.text(), f.name);
    });
    $('routeGpxBtn').addEventListener('click', () => {
      const t = plannedRoute;
      if (!t || !Array.isArray(t.lat) || t.lat.length < 2) return;
      saveFile(ApexRouteImport.toGpx(t.name, t.lat, t.lon), `${(t.name || 'route').replace(/[^\w-]+/g, '_').slice(0, 60)}.gpx`, 'application/gpx+xml');
    });
    async function routeToQuery() {
      const fromQ = $('fromInput').value, toQ = $('destInput').value;
      if ((!fromQ.trim() && !toQ.trim()) || $('planPanel').classList.contains('busy')) return;
      const link = typeof ApexRouteImport !== 'undefined' && ApexRouteImport.parseMapsLink(toQ);
      if (link) { openMapsLink(link); return; }
      const ui = planBusy();
      ui.step('Finding…', 0.3);
      try {
        toast('Searching…');
        const from = await resolvePlace(fromQ, 'fromInput');
        const to = await resolvePlace(toQ, 'destInput');
        ui.step('Routing…', 0.7);
        // Kept on the track so a reroute can rebuild it; from: null = the phone's position.
        const request = { from: from.label === null ? null : { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon }, via: [] };
        await funRoute(from, to, 'route_dest', to.routeName || `To ${to.label || 'current location'}`, request, ui);
        if (to.label && !to.label.startsWith('Pin ')) rememberPlace(to);
      } catch (err) { toast(errText(err)); } finally { ui.done(); }
    }
    // Live off-route handling. Notes, pace and trip distance stay blank while off route (render
    // gives no index); the old route stays drawn until the new one arrives.
    function feedRerouter(L, hit) {
      const near = hit.distM < 40;
      const r = rerouter.update({ t: Date.now(), distToRouteM: hit.distM, accuracyM: Number.isFinite(L.accuracy_m) ? L.accuracy_m : null,
                                  speedMps: L.speed_mps, progressM: near ? track.dist[hit.index] : null });
      if (!r.off && near) routeWatch.bestM = Math.max(routeWatch.bestM, track.dist[hit.index]);
      // the arrival stays up while a new route is on its way (as in Apple Maps) and the new route's replaces it; it goes
      // blank only off route with no new route coming (no signal, nothing to rebuild). Not yet confirmed off: unchanged.
      if (!r.off && near) paintEta(track.dist[hit.index]);
      else if (r.off && offRouteText() !== 'Rerouting…') paintEta(null);
      // U-90: "Back on route" once per episode, and only after one long enough to have been heard as off route (10 s);
      // never twice inside BACK_ON_QUIET_MS whatever the matcher does, so the line can never storm again.
      const now = Date.now();
      if (r.off && routeWatch.offAt == null) routeWatch.offAt = now;
      if (r.backOn) {
        routeWatch.note = null;
        const long = routeWatch.offAt != null && now - routeWatch.offAt > 10000, quiet = routeWatch.saidAt == null || now - routeWatch.saidAt > BACK_ON_QUIET_MS;
        if (long && quiet) { routeWatch.saidAt = now; say('Back on route'); }
        routeWatch.offAt = null;
      }
      if (r.request) reroute(track);
    }
    // The route's word in the status line while off it: one word per detour (TestFlight: "it tweaks when finding a new route";
    // it flipped "Checking route…", "Off route", "Rerouting…"). Farther than 40 m but not yet confirmed by the monitor (its
    // 5 s hold): no word, the road's own quiet line (null). Confirmed with a plan to rebuild: "Rerouting…" from then until the
    // new route is up, through the cooldown and a retry. No signal, or nothing to rebuild (a recorded drive, a GPX track):
    // what is true ("Off route", "Wrong way").
    const offRouteText = () => {
      if (!rerouter.off) return null;
      const wrong = rerouter.reason === 'wrong_way', note = routeWatch.note || '';
      if (note.endsWith('no signal to reroute')) return wrong ? 'Wrong way · no signal to reroute' : note;
      if (track && track.request && state.live) return 'Rerouting…';
      return wrong ? 'Wrong way' : 'Off route';
    };
    // Live time left and arrival on a planned route (eta.js): the router's time ahead at your pace on this route so far.
    // Blank off route, on a recorded drive, or when the router gave no time (OSRM fallback without one, an old restore).
    function paintEta(atM) {
      const now = Date.now(), on = track && track.kind === 'route' && atM != null;
      if (on && !etaSections.has(track)) etaSections.set(track, ApexEta.cornerSections(track.events));
      const est = on ? etaPace.update({ t: now, atM, totalM: totalM(), timeS: track.timeS, marks: track.timeMarks, sections: etaSections.get(track) }) : null;
      if (est) pushEtaShare(est.leftS, atM);
      if (est && track && track.homeBy && driveActive) {
        const o = ApexEta.homeByOffer(est.arriveAt, track.homeBy, track.homeByOfferedAt ?? null, now);
        // a stage still ahead is skipped first (the loop shortens itself, your call); with none left, the quickest way home
        if (o) { track.homeByOfferedAt = now; const a = ApexEta.homeByAction(track.stageSpans, routeWatch.bestM);
          offerKey(`Running ${o.lateMin} min late for home.`, `${o.lateMin} min late`, { label: a.label, ms: 15000, onClick: () => {
            const b = track ? ApexEta.homeByAction(track.stageSpans, routeWatch.bestM) : a;   // as of the tap (a reroute meanwhile)
            if (b.kind === 'skip') skipStage(b.span); else headHome(); } }); }
      }
      etaLeftS = est ? est.leftS : null;
      const text = est ? `${ApexEta.leftText(est.leftS, est.rough)} · ${etaClock().format(new Date(est.arriveAt))}` : '';
      if (text !== etaText) { etaText = text; paintDriveStat(); }
    }
    // Perf: one clock formatter (toLocaleTimeString built a new one with every fix); the same words as before
    let etaClockFmt = null;
    const etaClock = () => etaClockFmt || (etaClockFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }));
    // Share your ETA (IDEAS S-19; backend/src/eta_share.ts, web/eta.html): a link that shows only the handle and arrival
    // time, refreshed about once a minute while the route is driven, ended on arrival or with the button.
    const etaShare = { token: null, at: 0, left: null };
    async function pushEtaShare(leftS, atM) {
      if (!etaShare.token || performance.now() - etaShare.at < 60000) return;
      etaShare.at = performance.now();
      const arrived = track && atM != null && totalM() - atM < 150;
      try { await ApexSync.apiFetch(`/api/eta/${etaShare.token}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(arrived ? { ended: 'arrived' } : { left_s: Math.round(leftS) }) }); } catch (_) { /* next minute */ }
      if (arrived) { etaShare.token = null; paintEtaShareBtn(); toast('Arrived. Your shared ETA now says so.'); }
    }
    function paintEtaShareBtn() {
      const b = $('etaShareBtn'), on = !!etaShare.token;
      b.textContent = on ? 'Stop sharing ETA' : 'Share ETA'; b.setAttribute('aria-pressed', String(on));
      b.hidden = !on && !(plannedRoute && Number.isFinite(plannedRoute.timeS));
    }
    $('etaShareBtn').addEventListener('click', async () => {
      if (etaShare.token) {
        const t = etaShare.token; etaShare.token = null; paintEtaShareBtn();
        try { await ApexSync.apiFetch(`/api/eta/${t}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ended: 'stopped' }) }); } catch (_) {}
        toast('Stopped sharing your ETA.'); return;
      }
      const t = plannedRoute;
      if (!t || !Number.isFinite(t.timeS)) return;
      let r = null;
      try { r = await ApexSync.apiFetch('/api/eta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ left_s: Math.round(t.timeS) }) }); } catch (_) {}
      if (!r) { toast('No signal. Try again in a moment.'); return; }
      if (r.status === 401 || r.status === 403) { askSignIn('share your ETA'); return; }
      if (!r.ok) { toast(r.status === 429 ? 'You\'re sharing three already. Stop one first.' : 'Couldn\'t share it. Try again.'); return; }
      etaShare.token = (await r.json()).token; etaShare.at = performance.now(); paintEtaShareBtn();
      copyText(`${shareOrigin()}/eta.html?t=${etaShare.token}`, 'Link copied. It shows when you\'ll arrive, never where you are.', 'My ETA');
    });
    // "Home by" on a loop (IDEAS R-37): the route card's time; while driving, late by more than 5 min offers the direct way back
    // to the loop's start, planned like any destination at the Quick level.
    function paintHomeBy() {
      const t = plannedRoute, loop = !!(t && String(t.id || '').startsWith('loop_'));
      $('homeByRow').hidden = !loop;
      if (!loop) return;
      const at = Number.isFinite(t.homeBy) ? new Date(t.homeBy) : null, out = $('homeByOut');
      out.textContent = at ? ApexFormat.clock12(at.getHours(), at.getMinutes()) : '--:--';
      out.classList.toggle('unk', !at);
      out.setAttribute('aria-label', at ? `Home by ${out.textContent}` : 'Home by: no time set');
      $('homeByOff').hidden = !at;
    }
    // U-98: quarter hours. The first tap of either key sets the loop's own arrival (now plus its time, up to the next quarter
    // hour), the time a driver would most likely choose; never earlier than the next quarter hour from now.
    const QUARTER_MS = 15 * 60000;
    function stepHomeBy(dir) {
      const t = plannedRoute; if (!t) return;
      const now = Date.now(), soonest = Math.ceil(now / QUARTER_MS) * QUARTER_MS, was = Number.isFinite(t.homeBy);
      const next = was ? t.homeBy + dir * QUARTER_MS : Math.ceil((now + (Number.isFinite(t.timeS) ? t.timeS * 1000 : 0)) / QUARTER_MS) * QUARTER_MS;
      t.homeBy = Math.max(soonest, next); t.homeByOfferedAt = null;
      paintHomeBy();
      if (!was) toast(`Home by ${$('homeByOut').textContent}: if you're running late, Vetta offers the way back.`);
    }
    $('homeByLess').addEventListener('click', () => stepHomeBy(-1));
    $('homeByMore').addEventListener('click', () => stepHomeBy(1));
    $('homeByOff').addEventListener('click', () => { const t = plannedRoute; if (!t) return; t.homeBy = null; t.homeByOfferedAt = null; paintHomeBy(); });
    async function headHome() {
      const t = track, L = state.live;
      if (!t || !L) return;
      const home = { lat: t.lat[0], lon: t.lon[0] }, homeBy = t.homeBy;
      try {
        await buildRoute([{ lat: L.lat, lon: L.lon }, home], 'route_home', 'Home');
        if (plannedRoute) plannedRoute.homeBy = homeBy;
        toast('Heading home the quickest way.');
      } catch (_) { toast('Couldn\'t plan the way home. Check signal.'); }
    }
    // TestFlight ("it does not like when you don't take the intended route"): a deliberate detour is one quiet reroute, as in
    // Apple Maps and Google Maps. The new route starts where the car is, going the way it is already heading (no U-turn
    // back to the old road); "Rerouting" is said once per detour (RerouteMonitor.announce); the old route stays drawn until
    // the new one replaces it in one frame (activate's seamless swap), and a car that rejoined the plan meanwhile keeps it.
    async function reroute(t) {
      const req = t.request, L = state.live;
      if (!req || !L) { routeWatch.note = 'Off route'; return; }   // a recorded drive has no plan to rebuild
      const failed = () => { routeWatch.note = 'Off route · no signal to reroute'; rerouter.requestFailed(Date.now()); };
      // (no signal: our tiles still reroute where they cover the way; routePoints below)
      if (navigator.onLine === false && !ownOn()) { failed(); return; }
      routeWatch.note = 'Rerouting…';
      if (rerouter.announce()) say('Rerouting');
      // From here through the via points still ahead (a loop's next unpassed waypoint, then the rest) to the destination.
      // Stage points stay shaping points, so a reroute still drives the fun roads ahead.
      const ahead = waysAhead(t);
      const points = [{ lat: L.lat, lon: L.lon, heading: headingOf(L) }, ...ahead, req.to];
      let r;
      try { [r] = await routePoints(points, { osrm: true, level: t.funLevel || (isLoop(t) ? LOOP_STYLE : 'quick') }); } catch (_) { failed(); return; }
      if (track !== t || state.mode !== 'live') return;           // the driver loaded something else meanwhile
      if (!rerouter.off) return;                                  // back on the planned route meanwhile: it stays
      const nt = await trackAhead(t, r, ahead);
      if (track !== t || state.mode !== 'live' || !rerouter.off) return;
      await buildRoute(null, t.id, t.name, nt);                     // activate() resets the monitor for the new route
    }
    // The rest of plan t as a new track from where the car is: route r through the via points still ahead
    function waysAhead(t) {
      return t.request.via.filter(v => v.distM == null || v.distM > routeWatch.bestM).map(v => ({ lat: v.lat, lon: v.lon, ...(v.shaping ? { shaping: true } : {}), ...(v.planned ? { planned: true } : {}), ...(v.label ? { label: v.label } : {}) }));
    }
    async function trackAhead(t, r, ahead) {
      const nt = await trackFromPolyline(r.coords, t.id, t.name);
      Object.assign(nt, { request: { from: null, to: t.request.to, via: ahead }, fun: funOf(nt, r.turns), timeS: r.timeS, timeMarks: timeMarksOf(nt, r), steps: stepsOf(nt, r) });
      ownInstructLater(nt, r);
      if (t.stageSpans) nt.stageSpans = FunRoute.stageSpans(nt, t.stageSpans.filter(s => s.endM > routeWatch.bestM));
      return nt;
    }
    // Avoid police reports, while driving (docs/ROUTING.md): a live report that lands on the route ahead (0.8 to 25 km on,
    // within 150 m of it) is offered once, with Go round: the rest of the plan from here, routed round the reports. A way
    // that still passes it isn't taken, and that's said. Off with the switch; looked at every 5 s at most.
    const policeAhead = { at: 0, offered: new Set() };
    function policeAheadTick(me) {
      const t = track, now = Date.now();
      if (!avoid.police || !t || !t.request || t.kind !== 'route' || state.mode !== 'live' || !driveActive || rerouter.off || now - policeAhead.at < 5000) return;
      policeAhead.at = now;
      const pts = ApexHazardReports.policeFor(reported.list, [me, t.request.to], now, convoyPolice());
      const hit = ApexHazardReports.onRouteAhead(t, routeWatch.bestM, pts);
      if (window.apexDebug) window.apexDebug.policeAhead = { n: reported.list.length, pts: pts.length, hit };
      if (!hit) return;
      const key = `${hit.lat.toFixed(4)},${hit.lon.toFixed(4)}`;
      if (policeAhead.offered.has(key)) return;
      policeAhead.offered.add(key);
      const far = ApexUnits.long(hit.aheadM, 1);
      offerKey(`Police reported on your route in ${far}.`, `Police in ${far}`, { label: 'Go round', ms: 15000, onClick: () => goRoundPolice(t, hit, pts) });
    }
    async function goRoundPolice(t, hit, pts) {
      const L = state.live;
      if (track !== t || !L || !t.request) return;
      const ahead = waysAhead(t);
      let r;
      try { [r] = await routePoints([{ lat: L.lat, lon: L.lon, heading: headingOf(L) }, ...ahead, t.request.to], { osrm: true, level: t.funLevel || (isLoop(t) ? LOOP_STYLE : 'quick'), avoid: { ...avoid, points: pts } }); }
      catch (_) { toast('Couldn\'t plan a way round. Check signal.'); return; }
      if (track !== t || state.mode !== 'live') return;
      if (!r || ApexHazardReports.passesNear(r.coords, [hit])) { toast('No way round that police report. Staying on this route.'); return; }
      const nt = await trackAhead(t, r, ahead);
      if (track !== t || state.mode !== 'live') return;
      await buildRoute(null, t.id, t.name, nt);
      toast('Going round the police report.');
    }
    // A reported road closure on the route ahead, while driving: a member's "Road closed" report that lands within 40 m of
    // the route 0.5 to 25 km on (graph_router.js CLOSED_M) is offered once, with Go round, as a police report is; no
    // switch (nobody wants a closed road). A way that still passes it isn't taken, and that's said. Every 5 s at most.
    const closedAhead = { at: 0, offered: new Set() };
    function closedAheadTick(me) {
      const t = track, now = Date.now();
      if (!t || !t.request || t.kind !== 'route' || state.mode !== 'live' || !driveActive || rerouter.off || now - closedAhead.at < 5000) return;
      closedAhead.at = now;
      const pts = ApexHazardReports.closuresFor(reported.list, t.request.to ? [me, t.request.to] : [me]);
      const hit = pts.length ? ApexHazardReports.onRouteAhead(t, routeWatch.bestM, pts, { m: 40, minM: 500 }) : null;
      if (window.apexDebug) window.apexDebug.closedAhead = { pts: pts.length, hit };
      if (!hit) return;
      const key = `${hit.lat.toFixed(4)},${hit.lon.toFixed(4)}`;
      if (closedAhead.offered.has(key)) return;
      closedAhead.offered.add(key);
      const far = ApexUnits.long(hit.aheadM, 1);
      offerKey(`Road closed on your route in ${far}.`, `Road closed in ${far}`, { label: 'Go round', ms: 15000, onClick: () => goRoundClosed(t, hit, pts) });
    }
    // The DOTs' word on the route ahead (road_events.js onRouteAhead, 2026-11-14): a crash or a one-way closure your way 1 to
    // 20 km on is offered once with Go round, as a reported closure is; slow traffic is said once. Every 5 s at most.
    const dotAhead = { at: 0, offered: new Set() };
    function dotAheadTick(me) {
      const t = track, now = Date.now();
      if (!window.ApexRoadEvents || !t || !t.request || t.kind !== 'route' || state.mode !== 'live' || !driveActive || rerouter.off || now - dotAhead.at < 5000) return;
      dotAhead.at = now;
      const near = ApexRoadEvents.near(roadEvents.list, me.lat, me.lon, now);
      const hit = near.length ? ApexRoadEvents.onRouteAhead(t, routeWatch.bestM, near, { maxM: 20000 }) : null;
      if (window.apexDebug) window.apexDebug.dotAhead = { n: near.length, hit };
      if (!hit || dotAhead.offered.has(hit.id)) return;
      dotAhead.offered.add(hit.id);                                     // (the call 600 m out still comes: "Crash ahead")
      const far = ApexUnits.long(hit.aheadM, 1), what = hit.kind === 'crash' ? 'Crash' : hit.kind === 'slow' ? (hit.label || 'Slow traffic') : hit.kind === 'ice' ? (hit.label || 'Icy road') : 'Road closed';
      if (hit.kind === 'slow' || hit.kind === 'ice') { say(`${what} on your route in ${far}.`, false, null, null, { kind: 'hazard', key: `dot:${hit.id}`, alert: true, tokens: ['line:rep_hazard'], named: true }); return; }
      const pts = [{ lat: hit.lat, lon: hit.lon }];
      offerKey(`${what} on your route in ${far}.`, `${what} in ${far}`, { label: 'Go round', ms: 15000,
        // (the public router hears of it with this session's own avoids, R-22: a crash is no closure in anyone's list)
        onClick: () => { avoidPoints.push(pts[0]); goRoundClosed(t, pts[0], pts, hit.kind === 'crash' ? 'that crash' : 'that closure', hit.kind === 'crash' ? 'Going round the crash.' : 'Going round the road closure.'); } });
    }
    async function goRoundClosed(t, hit, pts, that = 'that closure', going = 'Going round the road closure.') {
      const L = state.live;
      if (track !== t || !L || !t.request) return;
      const ahead = waysAhead(t);
      let r;
      try { [r] = await routePoints([{ lat: L.lat, lon: L.lon, heading: headingOf(L) }, ...ahead, t.request.to], { osrm: true, level: t.funLevel || (isLoop(t) ? LOOP_STYLE : 'quick'), avoid: { ...avoid, closed: pts } }); }
      catch (_) { toast('Couldn\'t plan a way round. Check signal.'); return; }
      if (track !== t || state.mode !== 'live') return;
      if (!r || ApexHazardReports.passesNear(r.coords, [hit], 40)) { toast(`No way round ${that}. Staying on this route.`); return; }
      const nt = await trackAhead(t, r, ahead);
      if (track !== t || state.mode !== 'live') return;
      await buildRoute(null, t.id, t.name, nt);
      toast(going);
    }
    // Traffic ahead (iOS app only; docs/ARCHITECTURE.md section 8). Every 2 min while on a planned route, Apple times the next
    // 20 km in chunks, now and at 3 am. A jam (or a slowdown) costs the route fun even with no delay; on a jam, a detour that
    // avoids it and is more fun than staying is offered for 6 s with Cancel, else "Traffic ahead · N min". Web and Android
    // have no traffic source and say nothing (a keyed provider through the Worker needs the owner's approval).
    function trafficTick(L, hit) {
      const t = track;
      if (!window.APEX_EMBED || !t || !t.request || rerouter.off || hit.distM >= 40 || !(L.speed_mps > 2)) return;
      if (!trafficMon.due(Date.now())) return;
      trafficMon.started();
      checkTraffic(t, hit.index).then((r) => trafficMon.done(Date.now(), r || {}), () => trafficMon.done(Date.now()));
    }
    async function checkTraffic(t, idx) {
      const chunks = ApexTraffic.chunksAhead(t.dist, t.dist[idx]);
      if (!chunks.length) return null;
      const pt = (i) => ({ lat: +t.lat[i].toFixed(6), lon: +t.lon[i].toFixed(6) });
      const reply = await askNative({ cmd: 'trafficProbe', chunks: chunks.map(c => ({ a: pt(c.i0), b: pt(c.i1) })) }, 90000);
      if (!reply || reply.busy) return null;
      const result = { throttled: !!reply.throttled };
      if (track !== t || state.mode !== 'live') return result;
      const probes = chunks.map((c, k) => {
        const keep = (_, i) => i % 5 === 0 || i === c.i1 - c.i0;    // every 25 m is plenty to compare paths
        const ours = { lat: t.lat.slice(c.i0, c.i1 + 1).filter(keep), lon: t.lon.slice(c.i0, c.i1 + 1).filter(keep) };
        const got = (Array.isArray(reply.results) && reply.results[k]) || {};
        return { ...ours, startM: c.startM, endM: c.endM, ...ApexTraffic.classifyChunk(ours, got.now, got.night) };
      });
      t.traffic = { at: Date.now(), probes };
      if (probes.some(p => p.level === 'jam')) await trafficDetour(t, idx, probes);
      return result;
    }
    async function trafficDetour(t, idx, probes) {
      const req = t.request, L = state.live, jams = probes.filter(p => p.level === 'jam');
      // Each jam once per 10 min on this route, switched, cancelled or not.
      if (!L || !trafficMon.shouldSay(jams.map(p => [p.startM, p.endM]), Date.now())) return;
      const delayS = probes.reduce((a, p) => a + (p.level === 'jam' || p.level === 'slow' ? p.delayS : 0), 0);
      const delayMin = Math.max(1, Math.round(delayS / 60));
      const stay = () => { toast(`Traffic ahead. ${delayMin} min slower.`); const n = ApexVoiceLines.num(delayMin);
        say(`Traffic ahead. ${delayMin} minute${delayMin === 1 ? '' : 's'} slower`, false, null, null, n ? { tokens: ['line:traffic_ahead', n, delayMin === 1 ? 'line:minute_slower' : 'line:minutes_slower'] } : {}); };
      // Only the driver's own stops still ahead: old shaping points may sit in the jam, and a detour gets its own.
      const ahead = req.via.filter(v => !v.shaping && (v.distM == null || v.distM > routeWatch.bestM)).map(v => ({ lat: v.lat, lon: v.lon }));
      const points = [{ lat: L.lat, lon: L.lon }, ...ahead, req.to];
      // Valhalla gives alternates only between two points; the exclusion variant works through vias too.
      const [base, excl] = await Promise.allSettled([valhallaRoutes(points, false, 2),
                                                      valhallaRoutes(points, false, 0, { exclude_polygons: ApexTraffic.jamPolygons(probes) })]);
      if (track !== t || state.mode !== 'live') return;
      if (base.status !== 'fulfilled' || !Number.isFinite(base.value[0].timeS)) { stay(); return; }
      const primary = base.value[0];
      const current = { timeS: primary.timeS, delayS };
      // A detour may not add anything the driver avoids (a toll, a highway) that the current route doesn't already use.
      const usesNow = FunRoute.unavoided(avoid, primary);
      const trips = [...base.value.slice(1), ...(excl.status === 'fulfilled' ? excl.value : [])]
        .filter(c => Number.isFinite(c.timeS) && !ApexTraffic.tooSlow(current, c.timeS)   // only score what could win
          && FunRoute.unavoided(avoid, c).every(k => usesNow.includes(k)));
      // The Plan route card's fun score (web/fun_route.js) on light geometry, times what traffic leaves of it. The current
      // route is scored as the router's way from here, which follows it.
      const scored = (r) => {
        const g = FunRoute.geometry(r.coords, Core), f = funOf(g, r.turns), tf = ApexTraffic.trafficFactor(g, probes);
        return { route: r, fun: f ? f.fun * tf.factor : null, crossesJam: tf.crossesJam };
      };
      const now = scored(primary), cands = [];
      for (const r of trips) { cands.push(scored(r)); await RouteLoading.yieldToUI(); }
      if (track !== t || state.mode !== 'live') return;
      const pick = Number.isFinite(now.fun) && ApexTraffic.pickDetour({ ...current, fun: now.fun }, cands.map(c => ({ fun: c.fun, timeS: c.route.timeS, crossesJam: c.crossesJam })));
      window.apexDebug && (window.apexDebug.lastTraffic = { now: now.fun, delayS, primaryS: primary.timeS, pick,
        cands: cands.map(c => ({ fun: c.fun, timeS: c.route.timeS, crossesJam: c.crossesJam })) });
      if (!pick) { stay(); return; }
      const c = cands[pick.index];
      const road = [...c.route.names].filter(([n]) => !primary.names.has(n)).sort((a, b) => b[1] - a[1]).map(([n]) => n)[0] || 'another road';
      const extraMin = Math.round(pick.extraS / 60);
      const sw = { cancelled: false };
      toast(`Traffic ahead. Switching to ${road}${extraMin > 0 ? `, ${extraMin} min longer` : ''}.`,
            { label: 'Cancel', ms: 6000, onClick: () => { sw.cancelled = true; say('Staying on this route'); } });
      say(`Traffic ahead. Switching to ${road}${extraMin > 0 ? `, ${extraMin} minute${extraMin === 1 ? '' : 's'} longer` : ''}`, false, null, null, { tokens: ['line:traffic_ahead', 'line:switching'], named: true });
      await new Promise(r => setTimeout(r, 6000));
      if (sw.cancelled || track !== t || state.mode !== 'live' || rerouter.off) return;
      // Pinned with shaping points along it, like a winning alternate in Plan, so a reroute stays on the detour (a short
      // detour gets its midpoint).
      const along = FunRoute.alongPoints(c.route.coords);
      if (!along.length) { const m = c.route.coords[Math.floor(c.route.coords.length / 2)]; along.push({ lat: m[1], lon: m[0], shaping: true }); }
      let route = c.route, nt = await trackFromPolyline(route.coords, t.id, t.name);
      if (track !== t || state.mode !== 'live') return;
      // The car moved on while this was decided (routing, scoring, 6 s): if it is already off the detour, route again from
      // where it is through the detour's points.
      const Lnow = state.live;
      if (Lnow && Core.nearestIndex(Lnow.lat, Lnow.lon, nt.lat, nt.lon, -1).distM > 40) {
        const order = (v) => Core.nearestIndex(v.lat, v.lon, nt.lat, nt.lon, -1).index;
        const pts = [...ahead, ...along].map(v => ({ v, i: order(v) })).sort((a, b) => a.i - b.i).map(x => x.v);
        try { [route] = await valhallaRoutes([{ lat: Lnow.lat, lon: Lnow.lon, heading: headingOf(Lnow) }, ...pts, req.to]); } catch (_) { return; }
        if (track !== t || state.mode !== 'live') return;
        nt = await trackFromPolyline(route.coords, t.id, t.name);
        if (track !== t || state.mode !== 'live') return;
      }
      const at = (v) => Core.nearestIndex(v.lat, v.lon, nt.lat, nt.lon, -1).index;
      const via = [...ahead, ...along].map(v => ({ v, i: at(v) })).sort((a, b) => a.i - b.i).map(x => x.v);   // in order along it
      Object.assign(nt, { request: { from: null, to: req.to, via }, fun: funOf(nt, route.turns), timeS: route.timeS, timeMarks: timeMarksOf(nt, route), steps: stepsOf(nt, route), unavoided: FunRoute.unavoided(avoid, route) });
      await buildRoute(null, t.id, t.name, nt);                     // activate() restarts the traffic clock for the new route
    }
    // Members: what others measured on these roads (d.t.measured) and a score adjustment for it (d.adjust: rough
    // −8 … smooth +3, banked ±2, docs/ROUTING.md; unmeasured roads are neutral). False when there is nothing to compare or no membership.
    async function applyMeasured(list, ui) {
      if (!window.ApexSync || !window.ApexContributor || list.length < 2 || !await RouteLoading.optional(ApexSync.member())) return false;
      ui.step('Checking road feel', 0.9);
      await Promise.all(list.map(async (d) => {
        try {
          const m = await Promise.race([ApexContributor.measuredAlong(d.t, async (ids) => { const r = await apiCall('GET', `/api/roads?ways=${ids.join(',')}`); return r.ok ? r.json() : null; }),
                                        new Promise(r => setTimeout(() => r(null), 12000))]);
          d.t.measured = m; d.adjust = ApexContributor.measuredAdjust(m);
        } catch (_) { /* offline or slow: keep the unadjusted score */ }
      }));
      return true;
    }
    // Members' measurements and confirmed hazards in discovery (measured_stages.js, IDEAS R-04): before the shortlist picks
    // which stages to time, broken roads drop, smooth and banked ones rise, closed ones go. Members only; any failure (offline,
    // signed out, slow) leaves the map's order exactly as it was.
    async function measuredStages(stages, c, radiusKm) {
      if (!window.ApexMeasuredStages || !window.ApexSync || !stages || !stages.length || (window.ApexFlags && !ApexFlags.on('measured_stages'))) return stages;
      try {
        if (!(await RouteLoading.optional(ApexSync.member(), 3000))) return stages;
        const boxes = ApexMeasuredStages.boxesFor(c, radiusKm) || [];
        const get = async (path) => { const r = await ApexSync.apiFetch(path, { method: 'GET' }); return r.ok ? r.json() : null; };
        const [cov, hz] = await Promise.all([
          Promise.all(boxes.map((b) => RouteLoading.optional(get(`/api/coverage?bbox=${b.join(',')}`), 5000).catch(() => null))),
          RouteLoading.optional(get(`/api/hazards?${ApexPrivacyZones.cellQuery(c.lat, c.lon, Math.min(50, Math.ceil(radiusKm)))}`), 5000).catch(() => null),
        ]);
        const ways = new Map();
        for (const j of cov) for (const w of (j && Array.isArray(j.ways) ? j.ways : [])) if (w && Number.isFinite(w.way)) ways.set(w.way, w);
        return ApexMeasuredStages.rescore(stages, [...ways.values()], Array.isArray(hz) ? hz : []);
      } catch (_) { return stages; }
    }
    // Destination routes: the most fun way within the chosen level's time budget (docs/ROUTING.md). Candidates are the
    // router's quickest route and its alternates, plus 1–2 stage detours timed with one matrix call; all are scored for fun
    // on the map geometry and ranked by fun against extra time. Anything that fails just leaves fewer candidates.
    const FUN_LEVEL = 'apex.funLevel';
    let funLevel = 'fun';
    try { funLevel = FunRoute.LEVELS[localStorage.getItem(FUN_LEVEL)] ? localStorage.getItem(FUN_LEVEL) : 'fun'; } catch (_) { /* storage off */ }
    async function funRoute(from, to, id, name, request, ui, opts = {}) {
      const level = funLevel, planT0 = Date.now();      // the early quickest counts from here, not from the router's answer
      // Valhalla is for Quick only (the owner, 2026-11-11: "I don't want subpar routes going out for users with a bad
      // connection"): Fun and Long way come from our own router or not at all, never Valhalla's routes or stage plans
      // (its trace_route still gives our chosen line its spoken directions: own_routing.js instruct)
      const ownOnly = level !== 'quick';
      const avoid = await avoidForTrip([from, to]);     // this plan's avoid choices, with the police reports near it
      const dev = (window.apexDebug && window.apexDebug.dev) || null;   // dev mode (devPlanner): off but for a developer
      if (dev && dev.apply) dev.apply();                                    // Route tuning's and the Dev panel's tune, as of now
      const tunedNow = dev && dev.tuned ? dev.tuned() : null;              // (the card says a plan was made with your tuning)
      // where the plan's time goes (apexDebug.planMarks: [step, ms from the plan's start]; the live harness reads them)
      const mark = (k) => { if (window.apexDebug) (window.apexDebug.planMarks = window.apexDebug.planMarks || []).push([k, Date.now() - planT0]); };
      if (window.apexDebug) { window.apexDebug.planMarks = []; window.apexDebug.optMarks = []; window.apexDebug.timeline = []; window.apexDebug.planStartAt = performance.now(); }
      const before = opts.early === false ? plannedRoute : null;   // a re-plan of the route on screen: what it's measured against
      // The stages round the whole trip (the map tiles' roads, scored, then the network step) don't need the router's answer:
      // they're found while it routes (live: 2 s of tile scoring after the routes came back)
      // the first route has the page and the router to itself: the stages' network step and the routes' context wait for it
      // to go up (FIRST_GATE_MS at most); stage discovery runs in its worker meanwhile
      let openGate = null;
      const firstUp = new Promise((r) => { openGate = r; setTimeout(r, FIRST_GATE_MS); });
      // ... and on screen: the work after it waits for the frame that shows it (live: the corridors and scoring that
      // followed at once held the first paint 0.2-0.3 s)
      const firstSeen = firstUp.then(() => new Promise((r) => { const go = () => setTimeout(r, 0); setTimeout(r, 100); if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); else go(); }));   // (a hidden page has no frames)
      // the map tiles along the straight line, fetched and decoded while the router routes (the route context reads them
      // next; the page is idle until the router answers)
      // Our own routing (own_routing.js, graph_router.js, docs/OWN_ROUTING.md): where the shipped graph tiles cover the
      // trip, the phone searches every road itself and our routes are the candidates (no stage plans needed); Valhalla's
      // quickest stays in the pool as a check. No tiles here, switched off, or our router failing: today's path, unchanged.
      // our quickest is asked for first, with the coverage question behind it (the worker answers in order; a trip off
      // the tiles answers it with an error, and its answer is only used when the tiles cover the trip)
      const ownQuickAsk = ownOn() ? tlTime('worker: quickest', ApexOwnRouting.quick(ownRouter(), { from, to, level, avoid, heading: from.heading, ...(dev ? dev.tuneReq() : {}) })) : null;
      // (Fun and Long way have no stand-in, so they wait longer for the index on a slow connection; null: not known)
      const coversAns = ownOn() ? await RouteLoading.optional(ownRouter().covers([from, to]), ownOnly ? OWN_COVERS_ONLY_MS : OWN_COVERS_MS).catch(() => null) : false;
      const ownCovered = coversAns === true;
      mark('covers');
      // Valhalla: today's router without our tiles; with them only a check, asked once our first route is drawn (its
      // answers' decoding on the page held that first draw up, live 2026-11-05)
      // (Fun and Long way never drive a highway: Valhalla is asked to keep off them too, route_engine.js levelCosting)
      const valhallaP = ownOnly || (dev && dev.on('forceOwn')) ? Promise.resolve([]) : (ownCovered ? firstSeen : Promise.resolve()).then(() => tlTime('valhalla: route', valhallaRoutes([from, to], false, 2, FunRoute.LEVELS[level].noHighway ? (connectorCosting() || {}) : {}))).catch(() => osrmRoutes([from, to])).catch(() => []);
      // (not with our tiles: the map tiles' road data is in them, and the context for our routes doesn't read it)
      if (!ownCovered) needCtx().then(() => { try { if (window.ApexOsmTiles && window.ApexRouteCtx && ApexRouteCtx.corridor && (!window.ApexFlags || ApexFlags.on('route_engine'))) ApexOsmTiles.prefetch([ApexRouteCtx.corridor('ahead', [[from.lon, from.lat], [to.lon, to.lat]], {})]); } catch (_) { /* nothing ahead: fetched with the context */ } });
      // members' measured roads round the trip go into our search itself (signed out or none: unchanged)
      // (scope first: on the tiles in hand when the corridor's aren't all in yet; then the whole corridor's plan follows,
      // and its new routes join the background refresh: ownRefine)
      // (kept per cell on the phone, so the search doesn't wait on the network: what isn't in within OWN_CROWD_MS is
      // planned on what was kept, and the whole corridor's plan after the card has the fresh answer: ownRefine. Signed out
      // the server has none to give: not asked)
      const crowdS = ownCovered && ownCrowdOn() ? ApexOwnRouting.crowdSoon(routeCtxOpts().lookupCells, from, to, OWN_CROWD_MS) : null;
      const ownReq = { from, to, level, prefs: searchPrefs(), avoid, heading: from.heading, crowd: crowdS ? tlTime('crowd (members\' roads)', crowdS.now) : null, ...(dev ? dev.tuneReq() : {}) };
      // (Long way's detours reach past the straight line's tiles: it waits for its corridor)
      const ownP = ownCovered ? tlTime('own plan (worker)', ApexOwnRouting.plan(ownRouter(), { ...ownReq, scope: level === 'max' ? 'full' : 'first', waitMs: OWN_FIRST_WAIT_MS })) : null;
      const ownFullP = ownP ? Promise.all([ownP, crowdS ? crowdS.late.catch(() => null) : null])
        .then(([r, late]) => (r && r.result && (r.result.partial || late) ? ApexOwnRouting.plan(ownRouter(), late ? { ...ownReq, crowd: late } : ownReq) : null)).catch(() => null) : Promise.resolve(null);
      // our quickest alone, first (one search): the first route on screen
      const ownQuickP = ownCovered ? ownQuickAsk : null;
      let direct;
      // The router's costing keeps off highways (use_highways 0.15), which is what sent routes through subdivisions and
      // business districts; so the highway-friendly quickest competes too (route_engine.js highwayCosting), unless avoided.
      const hwyCosting = !ownOnly && window.ApexRouteEngine && FunRoute.kmBetween(from, to) >= 2 && !(dev && dev.on('forceOwn')) ? ApexRouteEngine.highwayCosting(avoid, routingCar()) : null;
      // (asked with our routes too: Valhalla's highway-friendly quickest is the check, and the clock ours are put on)
      const hwyTry = hwyCosting ? (ownCovered ? firstSeen : Promise.resolve()).then(() => tlTime('valhalla: highway route', valhallaRoutes([from, to], false, 0, hwyCosting))).catch(() => []) : Promise.resolve([]);
      // Where to? stays instant (REVIEW_FEEL): the FIRST answer goes up at once, not held for the other requests, the
      // weather or anything else; the ranked routes replace it when they're ready, unless you've started driving it or
      // planned something else. With our tiles that is our own quickest (one search in the worker, about 0.1 s once its
      // tiles are in): Valhalla's answers are only checks then, and its instructions replace our maneuvers when they come.
      // Without, the router's first answer, whichever of its two requests lands first (live, the highway-costed one often
      // came back 0.4 s before the other). A re-plan of the route on screen (level, avoid, Route around it) keeps that
      // route up meanwhile: no early quickest.
      const early = { fired: false, shown: null };
      let quickNow = null;
      const fireEarly = (list) => {
        if (early.fired || opts.early === false) return;
        const q = FunRoute.keepAvoiding(list, avoid).filter(c => Number.isFinite(c.timeS)).reduce((x, y) => (!x || y.timeS < x.timeS ? y : x), null);
        if (!q) return;
        early.fired = true; quickNow = q;
        if (window.apexDebug) window.apexDebug.earlyKind = q.kind;
        setTimeout(() => {
          if (!q.t) { q.t = geometryOf(q); q.fun = funOf(q.t, q.route.turns); }
          early.shown = useOption({ id, name, request, level, quickest: q, list: [{ ...q, extraS: 0 }] }, 0, EARLY_SIGHT_MS).catch(() => null);
          early.shown.then(() => mark('firstUp'));
          early.shown.then(openGate);
        }, Math.max(0, EARLY_MS - (Date.now() - planT0)));
      };
      if (ownQuickP) ownQuickP.then((c) => { mark('quick'); if (c) fireEarly([c]); });
      const hwyCandsP = hwyTry.then((rs) => rs.filter(r => Number.isFinite(r.timeS)).map(r => ({ kind: 'router', highway: true, route: r, timeS: r.timeS, via: [] })));
      hwyCandsP.then((h) => { if (!ownCovered) fireEarly(h); });
      const own = ownP ? await ownP : { cands: [], reason: !ownOn() ? 'off' : coversAns == null ? 'index' : 'out', ms: 0 };
      const ownUsed = own.cands.length > 0;
      mark('own');
      // our quickest already on screen is the same route as the plan's quickest: the plan keeps that very candidate, so
      // the ranking can keep the route drawn (and the card says it was checked, not "Better route found")
      if (ownUsed && quickNow && quickNow.kind === 'own') {
        const k = own.cands.findIndex((c) => c.own && quickNow.own && c.own.edges.length === quickNow.own.edges.length && c.own.edges.every((e, i) => e === quickNow.own.edges[i]));
        if (k >= 0) { quickNow.ownRole = own.cands[k].ownRole; quickNow.own = own.cands[k].own; own.cands[k] = quickNow; }
      }
      if (window.apexDebug) window.apexDebug.lastOwn = { covered: ownCovered, used: ownUsed, reason: own.reason, ms: own.ms, n: own.cands.length, error: own.error || null, tiles: own.result ? own.result.tiles : null, routerMs: own.result ? own.result.ms : null, viewMs: own.result ? own.result.viewMs : null, geoMs: own.result ? own.result.geoMs : null, partial: own.result ? !!own.result.partial : null, quickMs: quickNow && quickNow.kind === 'own' ? quickNow.ownMs : null, quickLoadMs: quickNow && quickNow.kind === 'own' ? quickNow.ownLoadMs : null };
      // Fun and Long way with no route of ours: said plainly, with Quick a tap away (no Valhalla stand-in)
      if (ownOnly && !ownUsed) {
        if (window.apexDebug) window.apexDebug.ownOnlyFail = own.reason;
        try { if (window.ApexErrors && ApexErrors.reporter) ApexErrors.reporter.route(level, own.reason, own.error); } catch (_) { /* a report is never in the way */ }
        if (early.shown) return true;                                       // (never: the early quickest is ours too)
        const what = FunRoute.LEVELS[level].label;
        const msg = own.reason === 'out' ? `${what} routes use Vetta's own road map, which covers Ohio, Kentucky and Indiana so far. Quick works anywhere.`
          : own.reason === 'off' ? `${what} routes need Vetta's own router, which is switched off. Quick still works.`
          : own.reason === 'index' ? `Couldn't load Vetta's road map for this trip. Check signal and try again, or use Quick.`
          : `Couldn't plan a ${what} route just now. Try again, or use Quick.`;
        toast(msg, { label: 'Use Quick', ms: 12000, onClick: () => { setFunLevel('quick'); const u = planBusy(); funRoute(from, to, id, name, request, u, opts).catch((e) => toast(errText(e))).finally(() => u.done()); } });
        return false;
      }
      // with our routes in, Valhalla's answers are only checks, fetched alongside (below); without, today's path
      if (!ownUsed && !early.fired) openGate();                            // ours failed: Valhalla is asked now, not at the gate's time
      direct = ownUsed ? [] : await valhallaP;
      if (!direct.length && !ownUsed && !early.fired) { toast('Couldn\'t build the route. Check signal and try again.'); return false; }
      const directCands = ownUsed ? own.cands.slice() : direct.map(r => ({ kind: 'router', route: r, timeS: r.timeS, via: [] }));
      fireEarly(directCands);
      // the router's own routes get their context now, while the stages are found and timed (live: the context after the
      // plans added 3 s); the highway-costed route as soon as it lands; the stage plans each as it's routed. Ours carry
      // their static road data in the tiles: only the time-dependent providers run for them (OWN_CTX), at once
      if (!early.fired) openGate();                                         // no early quickest: nothing to wait for
      // ours: the tiles' road data and the time-dependent context as cached for the area (the forecast not waited for:
      // waitMs 0); the fresh context refines the pick after the card is up (ownRefine)
      const ctxRun = (cs, prefix) => (ownUsed ? contextOn(cs, OWN_CTX_MS, prefix, OWN_CTX, { waitMs: 0 }) : contextOn(cs, CTX_BUDGET_MS, prefix));
      // (ours too wait for the first route to be drawn: building their corridors is main-thread work, and done alongside
      // the first draw it made the second plan's first route slower than the first plan's, live 2026-11-05)
      const directCtx = (ownUsed ? firstSeen : firstUp).then(() => ctxRun(directCands.slice(), 'route'));
      // ours: every one's full track is built while the context runs, in both analysis workers (the engine picked the
      // router's own first choice in 2 of 8 live cases, 2026-11-08; a track is 0.05 s of a worker's time on 30 km)
      if (ownUsed) firstSeen.then(() => { for (const c of directCands) if (c !== quickNow) buildAhead(c, id, name, OWN_SIGHT_MS); });
      // ours: their light geometry, corners and forecasts while the context runs (the page is idle meanwhile)
      // (after the first route is drawn: that build has the page to itself)
      let ownTowns = null;                                                  // (ownPrep: the towns along ours)
      const ownPrep = ownUsed ? (async () => {
        await firstSeen;
        const prepAt = performance.now();
        let ran = Date.now();
        const leaving = new Date(leaveAt());
        for (const c of directCands) {
          if (!c.t) { c.t = geometryOf(c); c.fun = funOf(c.t, c.route.turns); }
          c.glare = FunRoute.glare(c.t, c.timeS, leaving);                // (as the pool's below: the lead ranking is the final one)
          if (Date.now() - ran > 40) { await RouteLoading.yieldToUI(); ran = Date.now(); }
        }
        tlSpan('geometry of our routes', prepAt);
        // the towns along them (the map tiles' places, fetched and decoded) while the context runs: they were 50-60 ms of
        // the critical path after it (live 2026-11-08); the checks that join later get theirs at the towns step
        const townsAt = performance.now();
        ownTowns = townsOn(directCands.map((c) => c.t), directCands).then(() => tlSpan('towns (ours, with the context)', townsAt)).catch(() => {});
        return weatherFetch(directCands);
      })().catch(() => new Map()) : null;
      const same = (a, b) => Math.abs((a.timeS || 0) - (b.timeS || 0)) < 1 && a.coords.length === b.coords.length;
      let hwyCands;
      if (ownUsed) {
        // Valhalla's checks (its quickest and its highway-friendly route) with their own context: they join the ranking
        // when they're in by the time ours is ready (already landed when our context is), else ours rank alone, on our
        // own clock; when they're in, ours go on Valhalla's clock where both are the same way (own_routing.js oneClock)
        const checksP = (async () => {
          const [vr, hw] = await Promise.all([RouteLoading.optional(valhallaP, OWN_CHECK_MS), RouteLoading.optional(hwyCandsP, OWN_CHECK_MS)]);
          const vrs = vr || [];
          const vq = vrs.filter(r => Number.isFinite(r.timeS)).reduce((x, y) => (!x || y.timeS < x.timeS ? y : x), null);
          const list = [...(vq ? [{ kind: 'router', route: vq, timeS: vq.timeS, via: [] }] : []), ...(hw || []).filter(h => !vrs.some(d => same(d, h.route)))];
          const clock = ApexOwnRouting.oneClock(own.cands, list.map((c) => c.route));
          if (window.apexDebug && window.apexDebug.lastOwn) window.apexDebug.lastOwn.clock = clock;
          if (list.length) await ctxRun(list, 'check');
          return list;
        })().catch(() => []);
        let checksIn = null;
        checksP.then((l) => { checksIn = l; });
        await directCtx; mark('ownCtx');
        // in already, or not at all: a timer here waits on a busy page (live: 150 ms asked, 310 ms waited)
        hwyCands = checksIn || []; mark('checks');
        if (window.apexDebug && window.apexDebug.lastOwn) window.apexDebug.lastOwn.checks = hwyCands.length;
      } else {
        // the highway-costed route the router also gave as its own is kept once (the one on screen, if it went up first)
        hwyCands = (await hwyCandsP).filter(h => h === quickNow || !direct.some(d => same(d, h.route)));
        // ... and it is then the router's own route as well: not pinned with shaping points as a highway-costed one would be
        for (let k = directCands.length - 1; k >= 0; k--) if (quickNow && quickNow.highway && hwyCands.includes(quickNow) && same(directCands[k].route, quickNow.route)) { directCands.splice(k, 1); quickNow.highway = false; }
      }
      const cands = [...directCands, ...hwyCands];
      const routerCands = cands.slice();
      const routerCtx = ownUsed ? directCtx : Promise.all([directCtx, hwyCands.length ? firstUp.then(() => ctxRun(hwyCands, 'hwy')) : null]).then(([a, b]) => a || b);
      // once the router's routes have their context, the best of them is likely the pick: its track is built meanwhile
      (ownPrep ? Promise.all([routerCtx, ownPrep]) : routerCtx).then(() => {
        try {
          const pool0 = FunRoute.keepAvoiding(routerCands, avoid);
          for (const c of pool0) if (!c.t) { c.t = geometryOf(c); c.fun = funOf(c.t, c.route.turns); }
          const lead = rankPool(pool0, level)[0];
          const c = lead && pool0.find((x) => x.t === lead.t);
          if (c && !(early.fired && c === quickNow)) buildAhead(c, id, name, ownUsed ? OWN_SIGHT_MS : undefined);
        } catch (_) { /* nothing built ahead: built after the ranking, as before */ }
      });
      // (Fun and Long way are our router's only, the owner 2026-11-11: Valhalla stage plans are gone with the fallback)
      ui.step('Scoring roads…', 0.9);
      // Avoid options are router preferences: drop candidates that still use an avoided road when any candidate doesn't.
      const pool = FunRoute.keepAvoiding(cands, avoid);
      // Score on light geometry (corners only); the full track (envelope, sight lines, notes) is built for the winner.
      const leaving = new Date(leaveAt());
      mark('poolStart');
      // (the page gets a turn only after 40 ms of this: a yield per candidate waited behind the map's own work, live
      // 2026-11-05: 0.3-0.7 s for seven candidates whose scoring took a tenth of that)
      let ranFor = Date.now();
      for (const c of pool) {
        if (!c.t) { c.t = geometryOf(c); c.fun = funOf(c.t, c.route.turns); }
        c.glare = FunRoute.glare(c.t, c.timeS, leaving);                    // minutes driving into a low sun, if you leave now
        if (Date.now() - ranFor > 40) { await RouteLoading.yieldToUI(); ranFor = Date.now(); }
      }
      const ctx = (async () => {                                           // the route context, alongside the towns lookup
        const rest = pool.filter((c) => !routerCands.includes(c));
        const [a, b] = await Promise.all([routerCtx, rest.length ? contextOn(rest, PLAN_CTX_MS, 'plan') : null]);
        return b || a;
      })();
      // and the forecasts, costed once the context is in (ours asked for theirs already)
      const forecasts = ownPrep ? await ownPrep : weatherFetch(pool);
      if (ownPrep) for (const c of pool) if (!forecasts.has(c) && c.t && window.ApexRouteWeather) forecasts.set(c, forecastOf(c));
      mark('pool');
      const townsAt = performance.now();
      if (ownTowns) await ownTowns;
      const townsLeft = ownTowns ? pool.filter((c) => !directCands.includes(c)) : pool;
      await townsOn(townsLeft.map(c => c.t), townsLeft); mark('towns'); tlSpan('towns', townsAt);
      await ctx; mark('ctx');
      if (!ownUsed) await weatherOn(pool, level, forecasts); mark('weather');   // ours: the forecast refines it after (ownRefine)
      tasteOn(pool);
      // the top few only; ours have members' measurements in the search already (crowd)
      if (!ownUsed) await applyMeasured(rankPool(pool, level).slice(0, 3).map(r => pool.find(c => c.t === r.t)), ui); mark('measured');
      await preferOn(pool, level); mark('prefer');
      const rankAt = performance.now();
      let ranked = rankPool(pool, level); mark('ranked'); tlSpan('rank', rankAt);
      // never an empty ranking (route_engine.js keeps the least bad when all break a hard constraint); if a future change
      // empties it anyway, today's ranking still gives a route
      if (!ranked.length) ranked = FunRoute.rank(pool, level);
      if (!ranked.length) { toast('Couldn\'t build the route. Check signal and try again.'); return false; }
      const best = ranked[0];
      const quickPool = pool.filter(c => Number.isFinite(c.timeS)).reduce((x, y) => (y.timeS < x.timeS ? y : x), best);
      // with the engine's parts, for the why line (at Fun and Long way a highway quickest isn't in the ranking: its value is)
      const quickest = ranked.find(c => c.t === quickPool.t) || (ranked.quickest && ranked.quickest.t === quickPool.t ? ranked.quickest : null) || quickPool;
      let shownEarly = null;                                               // the early first route (#294/#295), for the swap line
      if (early.fired) {                                                   // the quickest is already up: replace it unless it's taken
        const shown = await early.shown; mark('earlyAwaited');
        if (shown && (state.mode === 'live' || plannedRoute !== shown)) return true;
        shownEarly = shown;
      }
      // The best and up to two really different others (the level cards: each level's pick, then the others) stay on the
      // card (and faint on the map) to pick from.
      const offered = FunRoute.distinctOptions(ranked, 3);
      const lv = destLevels({ id, name, request, level, quickest, pool, builtLevel: level }, level);
      lv.tuned = tunedNow;
      if (lv.levels[level] == null) Object.assign(lv, { list: offered, levels: null, picked: 0 });   // (never: the same ranking)
      // the quickest already up is the only option: keep it as it is (no second draw of the same route and card), but
      // finish the plan as any other (aftercare, the debug record): only the redraw is skipped. Ours: whenever it is the
      // pick, alternates or not (the card and the faint alternates are painted from the options; a rebuild would be the
      // same track, since our plans never wait for the land cover: OWN_SIGHT_MS; live 2026-11-07 it cost 0.2-0.4 s)
      let kept = early.fired && offered[0].t === quickNow.t && (lv.list.length === 1 || ownUsed) ? await early.shown : null;
      if (kept && kept.sightPending && !ownUsed) kept = null;             // drawn before its land cover: built in full now
      let t = kept;
      if (kept) {                                                          // the ranking's word on it, on the card already up
        ownInstructions(offered[0]).then((src) => { if (src === 'valhalla') { kept.steps = stepsOf(kept, offered[0].route); kept.timeMarks = timeMarksOf(kept, offered[0].route); } }).catch(() => {});
        optionOnto(kept, offered[0], lv);
        routeOptions = Object.assign(lv, { current: kept });
        if (typeof renderRouteCard === 'function') { timeFromEnvelope(kept); renderRouteCard(kept); }   // its saved copy stays the one drawn
      } else {
        // the early quickest is already drawn: the ranked route takes its place on the map without a second stroke from
        // the start (a slow phone saw the line drawn twice, the second time from nothing). A re-plan you asked for (a level
        // card) still redraws quickly: that is your change, shown.
        penCarry = !!shownEarly;
        try { t = await useOption(lv, lv.picked, ownUsed ? OWN_SIGHT_MS : undefined); } finally { penCarry = false; }
      }
      mark('built');
      if (!t) return false;   // no toast: the route bar and card say it (REVIEW.md 1.2, Route bar: the bar is the toast)
      // finding 1: the card says what the ranking did: kept the first route, or replaced it, and why, in the card's numbers
      const was = shownEarly || before;
      if (was && typeof cardNote === 'function') cardNote(kept || (was === t) || (was.lat && t.lat && was.lat.length === t.lat.length && was.timeS === t.timeS)
        ? `Checked ${pool.length} route${pool.length === 1 ? '' : 's'}: this one is the best`
        : window.ApexRouteCard ? ApexRouteCard.swapNote(t, was, t.why, opts.head || 'Better route found') : 'Better route found');
      if (offered[0].infeasible && offered[0].ev && offered[0].ev.hard.length) toast(`No way round it: ${offered[0].ev.hard[0].label} on this route. Check before you go.`);   // every candidate broke a hard constraint
      else if (window.ApexRouteCar) routeAftercare(offered[0]);
      if (ownUsed) ownRefine(pool, level, routeOptions, t, forecasts, ownFullP);
      if (window.apexDebug) window.apexDebug.lastQuickS = Math.min(...pool.map((c) => c.timeS).filter(Number.isFinite));
      window.apexDebug && (window.apexDebug.lastFun = rankPool(pool, level).map(c => ({ kind: c.kind, fun: c.fun, timeS: c.timeS, value: c.value, adjust: c.adjust || 0, glare: c.glare, townKm: c.townKm, hwyKm: FunRoute.highwayKm(c), hwyRule: c.hwyRule || null,
        parts: c.parts || null, quality: c.ev ? c.ev.quality : null, confidence: c.ev ? c.ev.confidence : null, poorKm: c.ev ? c.ev.poorKm : null,
        ev: c.ev ? { km: c.ev.km, knownKm: c.ev.knownKm, poorBy: c.ev.poorBy, poorKmFilled: c.ev.poorKmFilled, businessKm: c.ev.businessKm, goodKm: c.ev.goodKm, builtKm: c.ev.builtKm, meanGate: c.ev.meanGate, qWeight: c.ev.qWeight,
          fun: c.ev.funGated ? { fun: c.ev.funGated.fun, good: c.ev.funGated.good } : null, penalties: c.ev.penalties, bonuses: c.ev.bonuses, signals: c.ev.stats && c.ev.stats.signals } : null })));
      // dev mode: the whole plan as it was ranked, for the Dev panel and its Copy debug JSON (developers only; web/dev_panel.js
      // summarises it when asked, so a plan pays for nothing but this object)
      if (dev && dev.allowed() && window.apexDebug) {
        const r = own.result || null;
        window.apexDebug.devPlan = { at: new Date().toISOString(), level, from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon }, pool, ranked, picked: offered[0], quickest,
          own: { covered: ownCovered, used: ownUsed, reason: own.reason, ms: own.ms, error: own.error || null, limitS: r ? r.limitS : null, a: r ? r.a : null, hwy: r ? r.hwy : null,
            routerMs: r ? r.ms : null, viewMs: r ? r.viewMs : null, geoMs: r ? r.geoMs : null, partial: r ? !!r.partial : null, tiles: r ? r.tiles : null, crowdEdges: r ? r.crowdEdges : null },
          timeline: window.apexDebug.timeline, planMarks: window.apexDebug.planMarks, tune: dev.tune(), switches: { ...(dev.settings() || {}), tune: undefined } };
        dev.planned();
      }
      return true;
    }
    // from the plan's start: the context alone takes 1.5-3 s, so the quickest goes up as soon as the router answers (live:
    // on screen by about 1.5 s with its track built) and the ranking replaces it
    const EARLY_MS = 0, EARLY_SIGHT_MS = 100, FIRST_GATE_MS = 1800;
    // Our own router (graph_worker.js), started at launch; the Valhalla check waits at most OWN_CHECK_MS once
    // our routes are in, and the chosen route's instructions at most OWN_INSTRUCT_MS (else our own maneuvers)
    const OWN_CHECK_MS = 2500, OWN_INSTRUCT_MS = 3000, OWN_COVERS_MS = 1500, OWN_COVERS_ONLY_MS = 8000, OWN_PLAN_MS = 6000, OWN_CROWD_MS = 250, OWN_FIRST_WAIT_MS = 700;
    // members' measured roads for our search: only signed in (the server answers sign_in_required otherwise)
    const ownCrowdOn = () => !!(window.ApexSync && typeof ApexSync.signedIn === 'function' && ApexSync.signedIn());
    // Own-routed plans: the tiles carry the static road data (land use, density, businesses, signals, the grid, the DEM,
    // corners) as the engine's own scores (route_ctx/graph.js), so only the time-dependent providers run, in OWN_CTX_MS.
    // Members' data is in the search already (crowd), the driver's For this drive choices are local.
    // (the national grid is the background refresh's: the v2 tiles carry its built-up evidence already, and its bundles
    // cost a first plan a second to fetch)
    const OWN_CTX = ['graph', 'conditions', 'wildlife', 'events', 'hazards-live', 'driver'], OWN_CTX_MS = 500, OWN_WEATHER_GRACE_MS = 0,
      // the ranked route's land cover (sight across bends): waited for this long on our plans, then the cautious 4 m;
      // what's late lands in the tile cache for the next plan
      OWN_SIGHT_MS = 100;   // (at most EARLY_SIGHT_MS: not asked; the land cover is loaded for the next plan meanwhile)
    let ownClient = null;
    // A candidate's light geometry (5 m samples and corners, fun_route.js geometry): ours come with it from the worker,
    // made there with the same function on the same line (graph_router.js host 'plan'); else made here
    function geometryOf(c) {
      const g = c && c.own && c.own.geo;
      if (!g || !g.lat || !g.lat.length) return FunRoute.geometry(c.route.coords, Core);
      const lat = Array.from(g.lat), lon = Array.from(g.lon);
      return { lat, lon, dist: lat.map((_, i) => i * 5), events: g.events };
    }
    // The plan's timeline (apexDebug.timeline: [what, start ms, end ms] from the plan's start; the live harness reads it):
    // tiles, the worker's searches, each context provider, the checks, ranking, track building, drawing and the card
    function tlSpan(k, start, end) {
      const D = window.apexDebug;
      if (!D || D.planStartAt == null || !Array.isArray(D.timeline)) return;
      D.timeline.push([k, Math.round(start - D.planStartAt), Math.round((end == null ? performance.now() : end) - D.planStartAt)]);
    }
    function tlTime(k, p) {
      if (!window.apexDebug || !p || typeof p.then !== 'function') return p;
      const s = performance.now();
      p.then(() => tlSpan(k, s), () => tlSpan(k + ' (failed)', s));
      return p;
    }
    // (dev mode: Force Valhalla turns ours off, Force own router turns it on whatever the flag or apex.ownRouting say)
    const ownOn = () => { const d = window.apexDebug && window.apexDebug.dev ? window.apexDebug.dev.settings() : null; if (d && d.forceValhalla) return false;
      return !!(window.ApexOwnRouting && window.ApexGraphRouter && ((d && d.forceOwn) || ApexOwnRouting.on())); };
    // Coverage is answered on the page from index.json (fetched once): asking the worker queued the question behind its
    // tile loading, live on the preview 1.5 s, and the plan gave up on our tiles (2026-11-05)
    let ownIndexP = null;
    // the shipped tiles' index and the region's (graph_tiles.js index(): the union, the region's asked once a day), so a
    // trip anywhere in OH+KY+IN is ours; without the reader, the shipped index alone
    const ownIndex = () => (ownIndexP || (ownIndexP = (window.ApexGraphTiles && ApexGraphTiles.index ? ApexGraphTiles.index()
      : fetch('data/graph/v1/index.json').then((r) => (r.ok ? r.json() : null))).then((j) => (j ? ApexGraphRouter.indexKeys(j) : null))
      .catch(() => null)).then((k) => { if (!k) ownIndexP = null; return k; }));   // (no index: unknown, asked again next time)
    const ownRouter = () => (ownClient || (ownClient = Object.assign(ApexGraphRouter.client({ url: 'graph_worker.js', timeoutMs: OWN_PLAN_MS }),
      { covers: (points) => ownIndex().then((keys) => (keys ? ApexGraphRouter.covers(keys, points) : null)) })));
    // Turn instructions for one of our routes: Valhalla's maneuvers on our line (trace_route), offline our own
    // (one request per route, however often it's asked for)
    const ownInstructed = new WeakMap();
    function ownInstructions(c) {
      if (!c || c.kind !== 'own' || !window.ApexOwnRouting) return Promise.resolve(null);
      if (!ownInstructed.has(c.route)) ownInstructed.set(c.route, tlTime('valhalla: turn instructions (after the card)', ApexOwnRouting.instruct(c.route,
        (body) => RouteLoading.json(`${VALHALLA}/trace_route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, OWN_INSTRUCT_MS),
        routeOf, FunRoute.costing(avoid, routingCar()), OWN_INSTRUCT_MS).catch(() => 'own')));
      return ownInstructed.get(c.route);
    }
    // Points routed (a reroute, a road from Best roads nearby, a suggestion, a road someone sent, a drive again, a link's or
    // a file's stops): on our tiles where they cover every point (no network needed: offline as well), else Valhalla (and
    // OSRM after it where the caller had that), as before. Ours get Valhalla's maneuvers later (ownInstructLater).
    const OWN_THROUGH_MS = 3000;
    // o.level: a reroute of a route planned at Fun or Long way keeps off the highways as it did (graph_router.js through;
    // Valhalla asked with use_highways 0); everything else is the quickest way between the points ('quick')
    async function routePoints(points, o = {}) {
      const level = FunRoute.LEVELS[o.level] ? o.level : 'quick';
      if (ownOn()) {
        const r = await RouteLoading.optional(ApexOwnRouting.through(ownRouter(), points, { level, avoid: o.avoid || avoid, prefs: searchPrefs() }), OWN_THROUGH_MS);
        if (r) { tlSpan('own through (worker)', performance.now()); return [r]; }
      }
      const extra = FunRoute.LEVELS[level].noHighway && window.ApexRouteEngine ? ApexRouteEngine.levelCosting(avoid, routingCar(), level) : {};
      if (o.osrm) { try { return await valhallaRoutes(points, false, 0, extra); } catch (_) { return osrmRoutes(points); } }
      return valhallaRoutes(points, false, 0, extra);
    }
    /** One of our routes on track t: Valhalla's spoken maneuvers replace ours when they come (never waited for). */
    function ownInstructLater(t, r) {
      if (!t || !r || r.source !== 'own') return;
      ownInstructions({ kind: 'own', route: r }).then((src) => { if (src === 'valhalla' && Array.isArray(t.lat)) { t.steps = stepsOf(t, r); t.timeMarks = timeMarksOf(t, r); } }).catch(() => {});
    }
    // The fresh time-dependent context (weather, events, works, deer), after the card is up for one of our plans: the pool
    // is ranked again with it, and the route on screen is swapped only when another now beats it by OWN_SWAP_POINTS, the
    // card saying why. Driving, a pick, another plan or a cleared route meanwhile: nothing changes.
    const OWN_REFINE = ['graph', 'context_grid', 'conditions', 'wildlife', 'events', 'hazards-live', 'driver'], OWN_REFINE_MS = 3000, OWN_SWAP_POINTS = 5;
    async function ownRefine(pool, level, o, shown, forecasts, fullP) {
      if (window.apexDebug) window.apexDebug.refineDone = false;          // (e2e: a flow waits for the card to settle)
      try {
        const t0 = Date.now();
        // the whole corridor's routes, when the first plan was made on the tiles in hand: the new ones join the pool
        const full = fullP ? await fullP : null, added = new Set();
        if (full && full.cands && full.cands.length) {
          const same = (a, b) => a.own && b.own && a.own.edges.length === b.own.edges.length && a.own.edges.every((e, i) => e === b.own.edges[i]);
          const clockOf = pool.find((p) => p.own && p.own.clock), k = clockOf ? clockOf.own.clock : 1;   // the pool's one clock
          for (const c of full.cands) if (!pool.some((p) => same(p, c))) { c.timeS *= k; c.route.timeS = c.timeS; c.t = geometryOf(c); c.fun = funOf(c.t, c.route.turns); c.glare = FunRoute.glare(c.t, c.timeS, new Date(leaveAt())); pool.push(c); added.add(c.t); }
        }
        // the towns the card couldn't wait for (Avoid towns on a weak signal: townsOn's 0.4 s) looked up again, given longer
        const noTowns = avoid.towns ? pool.filter((c) => c.townKm == null && c.t) : [];
        await Promise.all([contextOn(pool, OWN_REFINE_MS, 'refine', OWN_REFINE), noTowns.length ? townsOn(noTowns.map((c) => c.t), noTowns, OWN_REFINE_MS) : null]);
        await weatherOn(pool, level, forecasts);
        const ranked = rankPool(pool, level);
        const still = () => routeOptions === o && plannedRoute === shown && state.mode !== 'live';
        const now = ranked.find((c) => c.t === (o.list[o.picked] || {}).t), best = ranked[0];
        if (window.apexDebug) window.apexDebug.lastRefine = { ms: Date.now() - t0, shown: now ? now.value : null, best: best ? best.value : null, swapped: false, full: !!(full && full.cands && full.cands.length) };
        // dev mode: the panel shows this ranking (the one the card is now judged by), and the swap if there is one
        const dev = (window.apexDebug && window.apexDebug.dev) || null;
        const dp = dev && dev.allowed() && window.apexDebug.devPlan && window.apexDebug.devPlan.pool === pool ? window.apexDebug.devPlan : null;
        if (dp) { dp.ranked = ranked; dp.refined = window.apexDebug.lastRefine; dev.planned(); }
        // (the route shown can drop out of the ranking altogether: the whole corridor's plan found a quicker way, and the
        // level's budget over it leaves the shown one too long; then the best goes up whatever the margin)
        const gone = !now && !!best;
        if (!best || (!now && !gone) || (now && (best.t === now.t || !(best.value > now.value + OWN_SWAP_POINTS))) || !still()) {
          // the route stays: its overview again from the fuller context (land cover, lanes, housing: the first ranking of our
          // own routes holds only the tiles' channels), in place, only where the words change
          if (now && still() && now.ctx && now.corridor) { Object.defineProperty(shown, 'ranked', { value: now, configurable: true, writable: true, enumerable: false }); paintStory(shown, true); }
          return;
        }
        const d = (k) => ((best.parts && best.parts[k]) || 0) - ((now && now.parts && now.parts[k]) || 0);
        // a route the wider search found only now isn't about the weather: say what it is
        const why = gone ? 'Quicker way found' : added.has(best.t) ? 'Found a better way' : d('weather') + (d('penalty') > 0 ? d('penalty') : 0) >= 1 ? 'Weather ahead' : 'Conditions ahead';
        // the level cards again from the refined ranking (it used to pass a copy useOption always refused: routeOptions is it now)
        const n = destLevels({ ...o, current: shown }, level);
        if (n.levels[level] == null) return;
        routeOptions = n;
        const t = await useOption(n, n.picked, OWN_SIGHT_MS);
        if (!t) { if (routeOptions === n) { routeOptions = o; paintLevelCards(); } return; }
        const road = best.route && best.route.names instanceof Map ? [...best.route.names].sort((x, y) => y[1] - x[1])[0] : null;
        if (typeof cardNote === 'function') cardNote(`${why}: switched to ${road ? `the way by ${road[0]}` : 'a better way'}`);
        if (window.apexDebug) window.apexDebug.lastRefine.swapped = true;
        if (dp) { dp.picked = best; dev.planned(); }
      } catch (_) { /* the card stays as it is */ } finally { if (window.apexDebug) window.apexDebug.refineDone = true; }
    }
    // Warm tiles (OWN_ROUTING.md §5): the tile you are in is read into the worker soon after start (the app's bundled
    // files, kept in IndexedDB), and again when you've moved 10 km; its neighbours load when a plan needs them (never
    // the 17 MB round you up front: on a first visit that held the first plans' context and drawing up, 2026-11-05)
    let ownWarmAt = null;
    function warmOwnTiles() {
      try {
        const p = state.lastPosition || JSON.parse(localStorage.getItem(LAST_POS) || 'null');
        if (!p || !Number.isFinite(p.lat) || !ownOn() || localStorage.getItem('apex.ownWarm') === '0' || (ownWarmAt && FunRoute.kmBetween(p, ownWarmAt) < 10)) return;
        ownWarmAt = { lat: p.lat, lon: p.lon };
        const t0 = Date.now();
        try { if (window.ApexAnalysis && ApexAnalysis.prewarm) ApexAnalysis.prewarm(); } catch (_) { /* started on first use */ }   // the tracks' workers
        ownRouter().covers([p]).then((ok) => (ok ? ownRouter().preload({ lat: p.lat, lon: p.lon, km: 0 }) : null))
          .then((r) => {
            if (window.apexDebug) window.apexDebug.ownWarm = r ? { ...r, wallMs: Date.now() - t0 } : null;
            // then the region's tiles within OWN_KEEP_KM kept on the phone (the app's own are there already): a plan
            // round you never waits on the network for its tiles, and works offline (bytes only, one at a time, after
            // any plan: graph_router.js host 'keep')
            if (r) ownRouter().keep({ lat: p.lat, lon: p.lon, km: OWN_KEEP_KM }).then((k) => { if (window.apexDebug) window.apexDebug.ownKept = k; }).catch(() => {});
          }).catch(() => { ownWarmAt = null; });
      } catch (_) { /* no position or no worker: the first plan loads its tiles */ }
    }
    const OWN_KEEP_KM = 15;
    // a drive on a planned route (IDEAS F-04): our road network within 2 km of all of it kept on the phone as it starts, with
    // signal, so a reroute in a dead zone 40 km on still has roads (the 15 km round you above doesn't reach that far yet).
    // A few seconds in, after the drive's own start; bytes only, one tile at a time; tiles kept already are skipped.
    // The map along it too (offline_tiles.js keepAhead), unless the route was saved for offline (its area holds more): a
    // narrow corridor, so the drive screen and its dead zones have a map where only the overview was looked at.
    function keepNetworkAlong(t) {
      if (!t || t.kind !== 'route' || !Array.isArray(t.lat) || t.lat.length < 2 || navigator.onLine === false || window.APEX_REVIEW) return;
      const net = !!(window.ApexGraphTiles && ApexGraphTiles.keepAlong && ownOn() && localStorage.getItem('apex.ownWarm') !== '0');
      const map = !!(window.ApexOfflineTiles && ApexOfflineTiles.keepAhead && localStorage.getItem('apex.mapAhead') !== '0'
        && !ApexOfflineTiles.areas().some((a) => a.id === routeAreaId(t)));
      if (!net && !map) return;
      setTimeout(async () => {
        if (track !== t) return;                                        // another route (or none) by then
        if (net) await ApexGraphTiles.keepAlong(t.lat, t.lon).then((k) => { if (window.apexDebug) window.apexDebug.keptAlong = k; }).catch(() => {});
        if (map && track === t && NATIVE_SHELL && ApexOfflineTiles.setCarAhead) ApexOfflineTiles.setCarAhead(t.lat, t.lon);   // the car's map too
        if (map && track === t) await ApexOfflineTiles.keepAhead({ lat: t.lat, lon: t.lon, styleUrl: MAP_STYLE })
          .then((k) => { if (window.apexDebug) window.apexDebug.mapAhead = k; }).catch(() => {});
      }, 5000);
    }
    // at launch, before any position: the tiles' index (the region's is asked once a day, kept for offline) and the
    // routing worker with its scripts, so a first plan never waits for either (2026-11-08: on the website the worker was
    // started by the first plan when the map had no fix yet, its four scripts fetched after Enter: 0.8 s)
    try { if (ownOn()) { ownIndex(); ownRouter().ready().catch(() => {}); } } catch (_) { /* started by the first plan */ }
    // every second until the first fix is in (a fresh install has no saved position), then every 15 s
    (function warmLoop() { warmOwnTiles(); setTimeout(warmLoop, ownWarmAt ? 15000 : 1000); })();
    // Router costing for the legs between good roads and the level's own Valhalla routes: Fun and Long way keep off the
    // highways (use_highways 0), Quick welcomes them (route_engine.js levelCosting; stage plans are only made at Fun and up)
    const connectorCosting = () => (window.ApexRouteEngine ? ApexRouteEngine.levelCosting(avoid, routingCar(), funLevel) : null);
    // A loop has no route style (the owner, 2026-11-10: "why do loops need a long way a fun and a quick? the whole point
    // is aimless driving"): every loop is found and ranked one way, the engine's Fun (good roads, about the length you
    // asked for, off the highways), whatever a destination's level is set to. Its card offers which way to head instead.
    const LOOP_STYLE = 'fun';
    // A loop's legs: highways a short link at most (route_engine.js loopCosting)
    const loopCosting = () => (window.ApexRouteEngine ? ApexRouteEngine.loopCosting(avoid, routingCar(), LOOP_STYLE) : null);
    // Tracks built ahead for a likely winner while the plan still waits on the stage plans (live: building the winner's
    // track after the ranking took 0.5-1 s): taken once, by the route line they were built from.
    const builtAhead = new WeakMap();
    function buildAhead(c, id, name, sightMs) {
      if (!c || !c.route || builtAhead.has(c.route.coords)) return;
      builtAhead.set(c.route.coords, trackFromPolyline(c.route.coords, id, name, sightMs, { ahead: true }).catch(() => null));
    }
    async function useOption(o, i, sightMs) {
      const c = (o.levels && o.levels[o.level] === i && o.picks[o.level]) || o.list[i], was = o.current;
      if (o.kind === 'loop') {                                             // a loop's options are whole tracks already
        if (was && (routeOptions !== o || plannedRoute !== was || state.mode === 'live')) return null;
        routeOptions = Object.assign(o, { picked: i, current: c.t });
        await buildRoute(null, o.id, c.t.name, c.t);
        return c.t;
      }
      const ahead = builtAhead.get(c.route.coords);
      if (ahead) builtAhead.delete(c.route.coords);
      const instructed = ownInstructions(c);                  // ours: Valhalla's maneuvers, fetched while the track builds
      const pm = (k) => { if (window.apexDebug && window.apexDebug.planStartAt != null) (window.apexDebug.optMarks = window.apexDebug.optMarks || []).push([k, Math.round(performance.now() - window.apexDebug.planStartAt)]); };
      pm(ahead ? 'trackAhead' : 'trackStart');
      const t = (ahead && await ahead) || await trackFromPolyline(c.route.coords, o.id, o.name, sightMs);
      pm('trackDone');
      // ours: the route goes up with our own maneuvers; Valhalla's replace them on the track when they land
      instructed.then((src) => { if (src === 'valhalla' && t && Array.isArray(t.lat)) { t.steps = stepsOf(t, c.route); t.timeMarks = timeMarksOf(t, c.route); } }).catch(() => {});
      // A pick (not the first build) is dropped if the route was cleared, replaced or driven meanwhile.
      if (was && (routeOptions !== o || plannedRoute !== was || state.mode === 'live')) return null;
      optionOnto(t, c, o);
      routeOptions = Object.assign(o, { picked: i, current: t });
      const drawAt = performance.now();
      await buildRoute(null, o.id, o.name, t);
      pm('drawn'); tlSpan(`draw ${o.id} + card`, drawAt);
      return t;
    }
    /** What the ranking says about option c, onto its track t (the card reads these): times, the why line, the engine. */
    function optionOnto(t, c, o) {
      // A winning alternate is pinned with shaping points along it, so a reroute stays on it; so is the highway-costed
      // route (the router's own costing would reroute it onto the side streets it avoided).
      // Ours always is: a reroute goes to Valhalla, which would otherwise take its own way.
      const via = c.kind === 'own' || (c.kind === 'router' && (c.extraS > 0 || c.highway)) ? FunRoute.alongPoints(c.route.coords) : c.via;
      // The why line: the engine's 2-3 largest differences from the quickest, else the roads and corners it's for.
      const engineWhy = window.ApexRouteEngine && c.parts ? ApexRouteEngine.why(c, o.quickest, { metric: ApexUnits.metric() }) : null;
      // your level's pick: a Fun or Long way pick that is the quickest says the trip has no road worth more time, and a
      // pick another route on the card (another level's pick included) looks better than (quicker, more corners) says
      // what it wins by, both measured at your level (the level cards: o.picks[level]; a loop's list: its first)
      const lvPick = o.picks && o.picks[o.level];
      const isPick = (lvPick ? lvPick.t === c.t : o.list && o.list[0] === c) && window.ApexRouteEngine && ApexRouteEngine.whyOver;
      const quickLine = isPick && !engineWhy ? ApexRouteEngine.whyQuickest(c, o.quickest, o.level) : null;
      // (at Fun and Long way a route on the highway is no rival: the pick keeps off it by the rule, which the line says)
      const offHwy = (x) => !c.hwyRule || c.hwyRule === 'any' || !(FunRoute.highwayKm(x) > FunRoute.HWY.FREE_KM);
      let rival = isPick && o.list ? o.list.find((x) => x.t !== c.t && offHwy(x) && FunRoute.dominates(x, c)) : null;
      if (rival && o.pool) rival = rankPool(o.pool, o.level).find((x) => x.t === rival.t) || rival;
      const overLine = rival ? ApexRouteEngine.whyOver(c, rival) : null;
      // Fun and Long way: the exception's highway, or no highway-free way in a sensible time (first: it's what you'd ask)
      const hwyLine = window.ApexRouteEngine && ApexRouteEngine.whyHighway ? ApexRouteEngine.whyHighway(c, { metric: ApexUnits.metric() }) : null;
      Object.assign(t, { tasteBonus: Number.isFinite(c.tasteBonus) ? c.tasteBonus : null, measured: c.t.measured, fun: c.fun, timeS: c.timeS, timeMarks: timeMarksOf(t, c.route), steps: stepsOf(t, c.route), extraS: c.extraS, funLevel: o.level, glareMin: c.glare ? Math.round(c.glare.minutes) : null, townKm: c.townKm,
                         engine: c.ev ? { quality: c.ev.quality, confidence: c.ev.confidence, poorKm: c.ev.poorKm, hard: c.ev.hard, penalties: c.ev.penalties } : null,
                         unavoided: FunRoute.unavoided(avoid, c.route), why: (hwyLine && hwyLine.kind === 'absurd' ? [hwyLine.text] : [hwyLine && hwyLine.text, (engineWhy && engineWhy.text) || (quickLine && quickLine.text) || whyText(FunRoute.why(c, o.quickest), fewerTownKm(c, o.quickest), c.extraS), overLine && overLine.text]).filter(Boolean).join('. ') || null,
                         request: { ...o.request, via: via.map(p => ({ lat: p.lat, lon: p.lon, shaping: true })) }, tuned: o.tuned || null });
      if (c.plan) t.stageSpans = FunRoute.stageSpans(t, c.plan.legs);   // where its stages are (Siri: next / skip, IDEAS V-07)
      Object.defineProperty(t, 'ranked', { value: c, configurable: true, writable: true, enumerable: false });   // the card's overview reads it (paintStory)
    }
    let optionBusy = false;
    async function pickOption(i) {
      const o = routeOptions;
      if (!o || optionBusy || loopBusy || i === o.picked || !o.list[i] || plannedRoute !== o.current || state.mode === 'live' || $('planPanel').classList.contains('busy')) return;
      // a level's pick (a swipe, the map or the car): as a tap on its card; two levels on it, the one nearer yours
      const ls = o.levels ? LEVEL_KEYS.filter((k) => o.levels[k] === i) : [];
      if (ls.length) {
        const L = ls.sort((a, b) => Math.abs(LEVEL_ORDER[a] - LEVEL_ORDER[funLevel]) - Math.abs(LEVEL_ORDER[b] - LEVEL_ORDER[funLevel]))[0], was = funLevel;
        setFunLevel(L);
        if (!(await takeLevel(o, L))) setFunLevel(was);
        return;
      }
      optionBusy = true;
      cardNote('');                                                        // what the ranking said was about the other route
      try { await useOption(o, i); } catch (_) { toast('Couldn\'t switch to that route. Try again.'); } finally { optionBusy = false; }
    }
    // finding 11: a swipe sideways on the card steps through the routes found (left: the next), the levels' picks in the
    // cards' order, then the others; the line under the cards says so
    {
      let sx = null, sy = 0;
      const card = $('routeCard');
      card.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1 || e.target.closest('input, textarea, .switch, .detents, .stepper, .plan-chips')) { sx = null; return; }
        sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      }, { passive: true });
      card.addEventListener('touchend', (e) => {
        if (sx == null) return;
        const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
        if (Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
        const o = routeOptions;
        if (!o || !optionsOffered(plannedRoute)) return;
        const i = o.picked + (dx < 0 ? 1 : -1);
        if (i >= 0 && i < o.list.length) { try { localStorage.setItem(SWIPED, '1'); } catch (_) { /* storage off: the sentence stays */ } pickOption(i); }
      });
      card.addEventListener('touchcancel', () => { sx = null; });
    }
    // The other options, faint on the map while the card offers them; nothing while driving or for any other route.
    function optionsOffered(t) {
      const o = routeOptions;
      return !!t && !!o && o.current === t && o.list.length > 1 && state.mode !== 'live';
    }
    function paintAlternates() {
      if (!mapReady || !map.getSource('apex-alt-src')) return;
      const o = routeOptions;
      map.getSource('apex-alt-src').setData(optionsOffered(plannedRoute) && track === plannedRoute ? { type: 'FeatureCollection', features: o.list.map((c, i) => ({ type: 'Feature', properties: { i },
        geometry: { type: 'LineString', coordinates: c.route.coords } })).filter(f => f.properties.i !== o.picked) } : emptyFC());
    }
    function setFunLevel(level) {
      if (!FunRoute.LEVELS[level]) return;
      funLevel = level;
      try { localStorage.setItem(FUN_LEVEL, level); } catch (_) { /* storage off: this session only */ }
      document.querySelectorAll('[data-fun]').forEach(b => b.title = FUN_NOTES[b.dataset.fun] || '');   // the sentence is the key's description, not prose under it
      paintLevelCards();
      paintPresets();
    }
    // The level cards (the owner, 2026-11-04: "quick, fun and long way are separate from the cards above? how the hell does
    // that work?"): one control. Each card is its level's own pick of the routes already found, its time and corners
    // (route_card.js levelCards); on when that pick is the route on screen, so two levels that pick the same route are both
    // on and the line under them says so. A level the plan didn't look at says "Look further"; a tap on it plans again.
    // The cards are the page's own buttons, only their words change, so the one you tapped is still there under your finger.
    const SWIPED = 'apex.cardSwiped';
    const swipeLearned = () => { try { return localStorage.getItem(SWIPED) === '1'; } catch (_) { return false; } };
    function paintLevelCards() {
      const box = $('routeCardFun');
      if (!box || !window.ApexRouteCard) return;
      const t = plannedRoute, o = routeOptions, mine = !!(t && o && o.current === t && state.mode !== 'live');
      const cards = ApexRouteCard.levelCards(mine ? o : null, funLevel);
      const part = (text, cls) => {
        const i = document.createElement('i'), m = /^(\S+) (\S+)$/.exec(text || '');
        if (cls) i.className = cls;
        i.textContent = m ? m[1] : text;
        if (m) { const sm = document.createElement('small'); sm.textContent = m[2]; i.append(' ', sm); }
        return i;
      };
      for (const b of box.querySelectorAll('[data-fun]')) {
        const k = cards.find((c) => c.level === b.dataset.fun), lv = b.querySelector('.rc-lv');
        if (!k || !lv) continue;
        if (k.further) lv.textContent = 'Look further';
        else lv.replaceChildren(part(k.time), part(k.corners, 'rc-lv-c'));
        b.classList.toggle('on', k.on);
        b.classList.toggle('further', k.further);
        b.setAttribute('aria-checked', String(k.level === funLevel));
        b.setAttribute('aria-label', k.further ? `${k.label}: not looked at yet; plans again` : `${k.label}: ${k.time === '--' ? 'time --' : k.time}, ${k.corners === '--' ? 'corners --' : k.corners}${k.same.length ? `, the same route as ${k.same.join(' and ')}` : ''}`);
      }
      // Page marks say "swipe" the way a phone does; the words stay beside them until the first swipe, then go. The line
      // under them keeps only what the marks can't say (two levels picking one route, a route no level picked).
      const pg = mine && !box.hidden ? ApexRouteCard.pager(o) : null, marks = $('routeCardPager');
      marks.hidden = !pg;
      if (pg) {
        marks.setAttribute('aria-label', pg.label);
        marks.replaceChildren(...Array.from({ length: pg.n }, (_, i) => { const m = document.createElement('i'); if (i === pg.at) m.className = 'on'; return m; }),
          Object.assign(document.createElement('span'), { textContent: `${pg.at + 1}\u2009/\u2009${pg.n}` }),
          ...(swipeLearned() ? [] : [Object.assign(document.createElement('small'), { textContent: 'Swipe the card for the next route' })]));
      }
      const line = mine && !box.hidden ? ApexRouteCard.levelNote(o, true) : '';
      $('routeCardLevelsNote').textContent = line;
      $('routeCardLevelsNote').hidden = !line;
    }
    // What each Roads position does, from fun_route.js LEVELS (the extra time each one may spend).
    const FUN_NOTES = { quick: 'Quick: the quickest way, highways and all; a nicer road only if it costs a minute or less.',
      fun: 'Fun: twistier roads that add up to about a third to the trip, never on the highway.', max: 'Long way: the twistiest roads around, up to nearly twice the time, never on the highway.' };
    // The plan flow (finding 4): the level lives on the card, as its cards. Each card is its level's ranking of the routes
    // the plan already found when they cover it (a plan at Fun holds the quick ones too; Long way's longer detours need a
    // plan of their own), with the engine's own ranking, why line and extra time, worked out once with the plan: a tap only
    // puts it up. A loop has no level (LOOP_STYLE).
    const LEVEL_ORDER = { quick: 0, fun: 1, max: 2 }, LEVEL_KEYS = ['quick', 'fun', 'max'];
    // how long a level change keeps the card you tapped under your finger while the card settles (changeLevel's settle)
    const SETTLE_MS = 3000;
    let settleStop = null;
    var optChipsReady = false;                                           // eslint-disable-line no-var -- read before its line runs
    async function changeLevel(level) {
      const t = plannedRoute, o = routeOptions, here = !!(t && o && o.current === t && o.levels && state.mode !== 'live');
      if (!FunRoute.LEVELS[level] || $('planPanel').classList.contains('busy') || loopBusy || optionBusy) return;
      // your level's card again, after a swipe to another route: back to its pick
      if (level === funLevel && !(here && o.levels[level] != null && o.picked !== o.levels[level])) return;
      const was = funLevel;
      // the card you tapped stays under your finger. The card above it is drawn again for the new route and can be far
      // shorter, and parts of it settle later still (CI, 2026-11-05: 90 px, some of it after the first frames; the sheet
      // itself moved 4-19 px). So the scroll is set from where that card now is in the content, never nudged by how far
      // it moved: scrollTop = its content offset - where it was on screen relative to the scroller's top, clamped. It is
      // applied every frame from the tap for SETTLE_MS, or until you touch, scroll or tap the card (then where you scroll
      // is yours), with the browser's own scroll anchoring off meanwhile so nothing else moves it.
      const swEl = () => document.querySelector(`#routeCardFun [data-fun="${level}"]`);
      const y0 = swEl() ? swEl().getBoundingClientRect().top : null;
      if (settleStop) settleStop();
      const settle = () => {
        const b = $('planBody');
        if (y0 == null || !b) return () => {};
        const apply = () => {
          const e = swEl(); if (!e) return;
          const top = b.getBoundingClientRect().top, offset = e.getBoundingClientRect().top - top + b.scrollTop;
          const want = Math.max(0, Math.min(b.scrollHeight - b.clientHeight, offset - (y0 - top)));
          if (Math.abs(b.scrollTop - want) > 0.5) b.scrollTop = want;
        };
        // every frame, not on resize events or scroll events: the card, its late rows and the sheet itself settle on
        // their own schedules (and a scroll event can't tell the app's own clamps from yours), so only your touch ends it
        let raf = 0, done = false;
        const loop = () => { if (done) return; apply(); raf = requestAnimationFrame(loop); };
        const yours = ['touchstart', 'wheel', 'pointerdown', 'keydown'];
        const stop = () => { if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(timer); for (const k of yours) b.removeEventListener(k, stop, true); b.style.overflowAnchor = ''; if (settleStop === stop) settleStop = null; };
        b.style.overflowAnchor = 'none';
        for (const k of yours) b.addEventListener(k, stop, true);
        const timer = setTimeout(stop, SETTLE_MS);
        settleStop = stop;
        loop();
        return stop;
      };
      setFunLevel(level);
      // held from the tap on, so every redraw on the way (not just the last) keeps the card where it was
      if (here && o.levels[level] != null) { settle(); if (!(await takeLevel(o, level))) setFunLevel(was); return; }
      if (!(await replanForLevel(FunRoute.LEVELS[level].label))) setFunLevel(was);
    }
    // A level's card: its pick, already found and ranked (destLevels), goes up; nothing is ranked or planned again.
    async function takeLevel(o, level) {
      const i = o.levels[level], label = FunRoute.LEVELS[level].label, prev = plannedRoute;
      const n = { ...o, level, quickest: (o.quicks && o.quicks[level]) || o.quickest, picked: i, current: prev };
      const same = !!o.list[o.picked] && o.list[o.picked].t === o.list[i].t;
      routeOptions = n;
      paintLevelCards();                                                   // the card you tapped is on at once
      let t = prev;
      if (same) { optionOnto(prev, n.picks[level], n); persistPlanned(prev); renderRouteCard(prev); }
      else {
        optionBusy = true;
        try { t = await useOption(n, i); } catch (_) { t = null; } finally { optionBusy = false; }
        if (!t) { if (routeOptions === n) { routeOptions = o; paintLevelCards(); } return false; }
      }
      const found = o.pool.length;
      cardNote(same ? `${label}: this route is still the best of the ${found} found`
        : `${ApexRouteCard.swapNote(t, prev, t.why, label)} (of the ${found} routes found)`);
      return true;
    }
    // The level cards' routes for a destination: each level's ranking of the pool the plan found, as far as the plan
    // looked (a plan at Fun holds the quick ones too; Long way's longer detours need a plan of their own).
    function destLevels(base, level) {
      const pool = base.pool, built = base.builtLevel || level;
      return withLevels(base, level, (L) => {
        if (LEVEL_ORDER[L] > LEVEL_ORDER[built]) return null;
        let ranked = rankPool(pool, L);
        if (!ranked.length) ranked = FunRoute.rank(pool, L);
        if (!ranked.length) return null;
        const quickPool = pool.filter(c => Number.isFinite(c.timeS)).reduce((x, y) => (y.timeS < x.timeS ? y : x), ranked[0]);
        return { offered: FunRoute.distinctOptions(ranked, 3), quickest: ranked.find(c => c.t === quickPool.t) || (ranked.quickest && ranked.quickest.t === quickPool.t ? ranked.quickest : null) || quickPool };
      });
    }
    // One list for the card: the levels' picks in the cards' order (one entry when two pick the same route), then up to two
    // other good ones of your level; levels[L] = its pick's index (null: not looked at), picks[L] its pick as that level
    // ranked it (time cost, why line), quicks[L] the quickest it was measured against.
    function withLevels(base, level, rankFor) {
      const list = [], levels = {}, picks = {}, quicks = {};
      let own = null;
      for (const L of LEVEL_KEYS) {
        const r = rankFor(L);
        if (!r || !r.offered.length) { levels[L] = null; continue; }
        const c = r.offered[0];
        let i = list.findIndex((x) => x.t === c.t);
        if (i < 0) { list.push(c); i = list.length - 1; }
        levels[L] = i; picks[L] = c; quicks[L] = r.quickest;
        if (L === level) own = r;
      }
      const picksN = list.length;
      for (const c of own ? own.offered.slice(1) : []) if (!list.some((x) => x.t === c.t) && list.length < picksN + 2) list.push(c);
      return Object.assign(base, { level, list, levels, picks, quicks, quickest: quicks[level] || base.quickest, picked: levels[level] != null ? levels[level] : 0 });
    }
    function setAvoid(next) {
      avoid = { ...avoid, ...next };
      try { localStorage.setItem(AVOID, JSON.stringify(avoid)); } catch (_) { /* storage off: this session only */ }
      document.querySelectorAll('[data-avoid]').forEach(b => { const on = !!avoid[b.dataset.avoid]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      paintOptChips();
    }
    // Changing the level (or what to avoid) re-plans a destination route that isn't being driven.
    async function replanForLevel(what = FunRoute.LEVELS[funLevel].label) {
      const t = plannedRoute;
      if (!t || t.id !== 'route_dest' || !t.request || state.mode === 'live') return true;
      if (t.request.via.some(v => !v.shaping)) { toast(`${what} from your next route. This one has your added stop.`); return true; }
      const ui = planBusy();
      ui.step('Routing…', 0.5);
      let ok = false;
      try {
        const from = t.request.from || await locate();
        if (!from) throw new Error(NO_FIX);
        ok = await funRoute(from, t.request.to, t.id, t.name, { from: t.request.from, to: t.request.to, via: [] }, ui, { early: false, head: what });
      } catch (err) { toast(errText(err)); } finally { ui.done(); }
      if (!ok && t.funLevel) setFunLevel(t.funLevel);             // the chips show the level the route on screen was built with
      return ok;
    }

    // There and back (the owner's "best routing for fun driving"): a drive out to a café or a viewpoint is two drives, and
    // the second should be new road. Our router pairs ways out and back (graph_router.js roundTrip: the way out costs x4
    // on the way back) where its tiles cover the trip; elsewhere the way out on the card stays and Valhalla is asked for the
    // way back around it (points along it as exclude_locations, the alternate that shares least with it). Either way the
    // whole trip is routed through shaping points with the destination as your stop, so Up / Down / Remove, a reroute and
    // a level change behave as on any trip with a stop. ROUND_SHAPE_KM: a shaping point that often holds the line.
    const ROUND_SHAPE_KM = 2.5, ROUND_SHAPE_MAX = 14;
    function outExclusions(coords, everyKm = 1, endKm = 1.5, max = 40) {
      const cum = [0];
      for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + FunRoute.kmBetween({ lat: coords[i - 1][1], lon: coords[i - 1][0] }, { lat: coords[i][1], lon: coords[i][0] }));
      const total = cum[cum.length - 1], out = [];
      if (total < 2 * endKm + everyKm) return out;
      const step = Math.max(everyKm, (total - 2 * endKm) / max);
      for (let at = endKm, i = 0; at <= total - endKm && out.length < max; at += step) { while (i < cum.length - 1 && cum[i] < at) i++; out.push({ lat: coords[i][1], lon: coords[i][0] }); }
      return out;
    }
    async function planRoundTrip() {
      const t = plannedRoute;
      if (!t || t.id !== 'route_dest' || !t.request || state.mode === 'live') return;
      const ui = planBusy();
      ui.step('Finding another way home…', 0.3);
      try {
        const from = t.request.from || await locate();
        if (!from) throw new Error(NO_FIX);
        const to = t.request.to, level = funLevel, place = (t.name || '').replace(/^To /, '') || 'there';
        const outCoords = Array.from(t.lat, (la, i) => [t.lon[i], la]);
        let outLine = outCoords, backLine = null, how = 'valhalla';
        const own = ownOn() ? await RouteLoading.optional(ApexOwnRouting.roundTrip(ownRouter(), { from, to, level, prefs: searchPrefs(), avoid, heading: from.heading, ...devTuneReq() }), 6000) : null;
        if (own && own.length) {
          // ours: the best pair (out and back), split at the destination
          const c = own[0].route.coords, k = c.reduce((b, p, i) => (FunRoute.kmBetween({ lat: p[1], lon: p[0] }, to) < FunRoute.kmBetween({ lat: c[b][1], lon: c[b][0] }, to) ? i : b), 0);
          outLine = c.slice(0, k + 1); backLine = c.slice(k); how = 'own';
        } else if (level !== 'quick') {
          // Fun and Long way are our router's or nothing (Valhalla is for Quick only, the owner 2026-11-11)
          toast(`Couldn't find a ${FunRoute.LEVELS[level].label} way back on Vetta's road map here. Quick can plan one.`);
          return;
        } else {
          const extra = FunRoute.LEVELS[level].noHighway && window.ApexRouteEngine ? ApexRouteEngine.levelCosting(avoid, routingCar(), level) : {};
          const backs = await valhallaRoutesExcluding([to, from], false, 2, extra, outExclusions(outCoords));
          const share = (r) => ApexOwnRouting.sharedShare(r.coords, outCoords);
          backLine = backs.length ? backs.reduce((a, b) => (share(b) < share(a) ? b : a)).coords : null;
        }
        if (!backLine) throw new Error('no way back');
        const shape = (line) => FunRoute.alongPoints(line, ROUND_SHAPE_KM, ROUND_SHAPE_MAX);
        const via = [...shape(outLine), { lat: to.lat, lon: to.lon, label: place }, ...shape(backLine)];
        const home = { lat: from.lat, lon: from.lon };
        await buildRoute([from, ...via, home], 'route_dest', `To ${place} and back`, null, { from: t.request.from, to: home, via, round: true });
        const r = plannedRoute;
        if (r && r !== t && Array.isArray(r.lat)) {
          // the share of the trip driven twice, said plainly (a dead-end valley has no other way, and the card says so)
          const line = Array.from(r.lat, (la, i) => [r.lon[i], la]), half = line.findIndex((p) => FunRoute.kmBetween({ lat: p[1], lon: p[0] }, to) < 0.06);
          const twice = half > 0 ? ApexOwnRouting.sharedShare(line.slice(half), line.slice(0, half + 1)) : null;
          r.roundTwice = twice;
          cardNote(twice == null ? 'There and back' : twice < 0.1 ? 'There and back: home by other roads all the way' : twice < 0.5 ? `There and back: ${Math.round((1 - twice) * 100)}% of the way home is new road`
            : 'There and back: no other way home here, so it comes back the way it went');
          if (window.apexDebug) window.apexDebug.lastRound = { how, twice, via: via.length };
        }
      } catch (err) { toast(err && err.message === NO_FIX ? NO_FIX : 'Couldn\'t find a way back just now. Try again in a moment.'); }
      finally { ui.done(); }
    }
    $('routeRoundBtn').addEventListener('click', () => planRoundTrip());

    // A loop is any route from the start back to it with little driven twice, built from the best roads within reach
    // (the owner, 2026-11-04; CALL_SHEET): never a circle for its own sake. This circle through the start is only the last
    // resort, when neither the stage plans nor our own router found a loop.
    function loopWaypoints(c, miles, heading) {
      const rKm = (miles * 1.609344) / (2 * Math.PI * 1.35);
      const kmLat = 110.54, kmLon = 111.32 * Math.cos(c.lat * Math.PI / 180);
      const center = { lat: c.lat + rKm * Math.cos(heading) / kmLat, lon: c.lon + rKm * Math.sin(heading) / kmLon };
      const pts = [c];
      for (const k of [1, 2, 3]) { const a = heading + Math.PI + k * Math.PI / 2; pts.push({ lat: center.lat + rKm * Math.cos(a) / kmLat, lon: center.lon + rKm * Math.sin(a) / kmLon }); }
      pts.push(c);
      return pts;
    }
    // byTime { timeS, targetS }: a "home in N minutes" loop is judged on the router's drive time, not distance.
    function scoreLoop(t, miles, byTime = null) {
      const km = totalOf(t) / 1000, targetKm = miles * 1.609344;
      const retraced = Core.retracedShare(t.lat, t.lon);
      const score = byTime ? FunRoute.loopValue(t.fun, byTime.timeS, byTime.targetS, retraced) : FunRoute.loopValue(t.fun, km, targetKm, retraced);
      // good: corners off the router's junctions, as the fun score counts them
      return { score, good: t.fun ? t.fun.good : 0, retraced, km };
    }
    const totalOf = (t) => t.dist[t.dist.length - 1];
    // Busy state on the button that started a slow request: label and progress bar;
    // sibling buttons are disabled so a second tap can't start a second build.
    function busy(btn, group = []) {
      const label = btn.textContent;
      btn.classList.add('busy');
      group.forEach(b => { if (b !== btn) b.disabled = true; });
      return {
        step(text, frac) { btn.textContent = text; btn.style.setProperty('--progress', `${Math.round(frac * 100)}%`); },
        progress(frac) { btn.style.setProperty('--progress', `${Math.round(frac * 100)}%`); },   // the bar only: the key keeps its own word
        done() { btn.classList.remove('busy'); btn.textContent = label; btn.style.removeProperty('--progress'); group.forEach(b => { b.disabled = false; }); },
      };
    }
    let loopBusy = false;
    // finding 6: a loop shows its progress where you are looking: on the Find a loop key and the plan sheet's status line
    // when the sheet is up, on the card's progress line when a loop's card is (its length changed there); never a lone toast
    async function loop(miles, btn) {
      if (loopBusy || $('planPanel').classList.contains('busy')) return;
      loopBusy = true;
      // from the deck (or the car, or Options) the plan sheet comes up, so the loop's progress is in view
      if (!$('planPanel').classList.contains('open') && !$('planPanel').classList.contains('routed') && state.mode !== 'live' && !driveActive) { openPlan(true); btn = btn || $('findLoopBtn'); }
      const key = btn ? busy(btn, [...document.querySelectorAll('[data-loop-mi], [data-loop-min], [data-explore-min], [data-card-loop]')]) : null;
      const panel = planBusy();
      const ui = { step(text, f) { if (key) key.step(text, f); panel.step(text); }, done() { if (key) key.done(); panel.done(); } };
      try { await buildLoop(miles, ui); }
      catch (_) { toast('Couldn\'t build a loop. Check signal and try again.'); }
      finally { loopBusy = false; ui.done(); }
    }
    // A loop of `want` miles, or { minutes } of driving that ends back home (R-16). Time loops search as far as about
    // LOOP_KMH on back roads would take you, then plan and pick on drive time.
    const LOOP_KMH = 35;
    async function buildLoop(want, ui) {
      const c = await locate();
      if (!c) { toast(NO_FIX); return; }
      const minutes = typeof want === 'object' && want ? want.minutes : null;
      const miles = minutes ? Math.round(minutes / 60 * LOOP_KMH / 1.609344) : want;
      const targetKm = miles * 1.609344, targetS = minutes ? minutes * 60 : null;
      const asked = minutes ? ApexRouteCard.loopTime(minutes) : ApexUnits.long(miles * 1609.344, 0), loopId = minutes ? `loop_${minutes}min` : `loop_${miles}`;
      const L = { c, miles, targetKm, targetS, asked, loopId };
      setLoopBy(minutes ? 'time' : 'distance');                            // a loop asked for by time (Options, Siri) is changed by time on its card
      ui.step(`Finding roads for a ${asked} loop…`, 0.02);
      // 0. Our own router's loops (graph_router.js loop), where the tiles cover the start: from the best roads in reach
      // (Route tuning's road and avoid sliders shape its search: the tune rides with it, as with a plan's)
      applyDevTune();
      loopTuned = ownOn() ? userTuned() : null;
      // the police reports, cameras and closures round the start go into the loop's search, as a trip's do (until
      // 2026-11-12 loops got none of them: Avoid police and Avoid cameras did nothing for a loop)
      L.avoid = ownOn() ? await avoidForTrip(loopAvoidPoints(c, targetKm)).catch(() => avoid) : avoid;
      const ownLoopsP = ownOn() ? ApexOwnRouting.loops(ownRouter(), { start: { lat: c.lat, lon: c.lon }, km: targetKm, level: LOOP_STYLE, prefs: searchPrefs(), avoid: L.avoid, ...devTuneReq() }) : Promise.resolve([]);
      // Our loops only (Valhalla is for Quick, the owner 2026-11-11): the card goes up from them, or says why there are none
      const own = (await ownLoopsP).map((r) => ({ kind: 'own', route: r.route, hwyShare: r.hwyShare, pts: [c, ...FunRoute.alongPoints(r.route.coords), c] }));
      // Loops are our router's or nothing (Valhalla is for Quick only, the owner 2026-11-11): no stage loops or circle on
      // Valhalla stand in, nor refine ours; with none of ours, the card says why
      if (own.length) {
        L.ownTiles = true;
        if (await loopRound(L, own, ui, false)) return;
      }
      const here = ownOn() ? await RouteLoading.optional(ownRouter().covers([c]), OWN_COVERS_ONLY_MS).catch(() => null) : false;
      // our router failing (its worker errored or ran out of time) is not "no loop of that length"; loops it found that
      // none survived the build or the scoring is "rejected"
      const failed = here && ApexOwnRouting.lastLoopError;
      const why = !ownOn() ? 'off' : here == null ? 'index' : !here ? 'out' : failed ? 'failed' : own.length ? 'rejected' : 'none';
      if (window.apexDebug) window.apexDebug.loopOwnOnlyFail = why;
      // the length asked rides with it (never a place): "loop: none (25 mi)", "loop: failed (25 mi, graph router timed out)"
      try { if (window.ApexErrors && ApexErrors.reporter) ApexErrors.reporter.route('loop', why, failed ? `${asked}, ${failed}` : asked); } catch (_) { /* a report is never in the way */ }
      toast(!ownOn() ? 'Loops need Vetta\'s own router, which is switched off.'
        : here == null ? 'Couldn\'t load Vetta\'s road map here. Check signal and try again.'
        : !here ? 'Loops use Vetta\'s own road map, which covers Ohio, Kentucky and Indiana so far.'
        : failed ? `Vetta's router couldn't finish a ${asked} loop this time. Try again, or a shorter one.`
        : `Couldn't find a ${asked} loop on Vetta's road map from here. Try another length.`);
    }
    const loopCircle = (L) => ({ kind: 'circle', pts: loopWaypoints(L.c, L.miles, Math.random() * 2 * Math.PI), through: true, extra: loopCosting() || {} });
    /** Loop jobs routed (ours come routed) and built into tracks: { t, job, route, km, score, ... } for those that worked. */
    async function loopBuilt(L, jobs, ui) {
      let settled = 0;
      if (ui) ui.step(`Routing · 0 of ${jobs.length}`, 0.38);
      const routeJob = async (job) => {
        const [r] = await (job.route ? Promise.resolve([job.route]) : valhallaRoutes(job.pts, job.through, 0, job.extra || {}))
          .finally(() => { settled++; if (ui) ui.step(`Routing · ${settled} of ${jobs.length}`, 0.38 + 0.5 * settled / jobs.length); });
        if (job.plan && !FunRoute.keptStages(r.coords, job.plan)) throw new Error('stage skipped');   // a shortcut past the stage (R-14)
        // spurs on an even 5 m line: removeSpurs looks 400 points ahead, which on our router's sparse edge geometry was the
        // whole loop (it cut every one of them to nothing, live 2026-11-04)
        const even = Core.resamplePolyline(r.coords.map(p => p[1]), r.coords.map(p => p[0]), 5);
        const rs = Core.removeSpurs(even.lat, even.lon);
        const t = await trackFromPolyline(rs.lat.map((la, i) => [rs.lon[i], la]), L.loopId, `${L.asked} loop`, undefined, { route: r.graph ? r : null });
        t.fun = funOf(t, r.turns);
        t.unavoided = FunRoute.unavoided(L.avoid || avoid, r);
        t.timeS = r.timeS;
        t.timeMarks = timeMarksOf(t, r);
        const glare = FunRoute.glare(t, r.timeS, new Date(leaveAt()));
        t.glareMin = glare ? Math.round(glare.minutes) : null;
        const s = scoreLoop(t, L.miles, L.targetS && Number.isFinite(r.timeS) ? { timeS: r.timeS, targetS: L.targetS } : null);
        // a loop whose spurs were most of it (an out-and-back cut to nothing) isn't a loop (live: a 0 km "loop" won)
        if (s.km < 0.3 * L.targetKm) throw new Error('not a loop');
        return { t, job, route: r, ...s, hwyShare: Number.isFinite(job.hwyShare) ? job.hwyShare : null, score: s.score - FunRoute.glareCost({ glare }), spursCut: rs.removed };
      };
      return FunRoute.keepAvoiding((await Promise.allSettled(jobs.map(routeJob))).filter(r => r.status === 'fulfilled').map(r => r.value), L.avoid || avoid);
    }
    /** The route engine, towns, the length off, members' data and Prefer on built loops (each once), ranked by the level. */
    async function loopScored(L, done, ui) {
      // The route engine on loops: quality, scenery, side streets and penalties on the same scale (route_engine.js loopValue).
      const lc = done.map(d => ({ route: { coords: d.t.lat.map((la, i) => [d.t.lon[i], la]), turns: d.route.turns, times: d.route.times }, timeS: d.t.timeS, t: d.t, fun: d.t.fun, match: 'map_snap' }));
      // where our tiles have loops here, the tiles carry the road data Valhalla's map matching gave (route_ctx/graph.js
      // scores any line from the worker): its provider is skipped for every loop of the plan, ours and the map's stage
      // loops alike, so they're scored the same way and a slow or missing Valhalla doesn't hold the card (its 2.4 s)
      const lctx = contextOn(lc, CTX_BUDGET_MS, 'cand', null, null, L.ownTiles ? ['router'] : null);
      await townsOn(done.map(d => d.t), done);
      for (const d of done) { d.t.townKm = d.townKm; d.score -= FunRoute.townCost(d); }
      if (await lctx) done.forEach((d, i) => {
        d.lc = lc[i];
        const [got, want] = L.targetS && Number.isFinite(d.t.timeS) ? [d.t.timeS, L.targetS] : [d.km, L.targetKm];
        d.score += ApexRouteEngine.loopValue(lc[i], got, want, d.retraced, engineOpts('fun')) - FunRoute.loopValue(d.t.fun, got, want, d.retraced);
        if (lc[i].ev) d.t.engine = { quality: lc[i].ev.quality, confidence: lc[i].ev.confidence, poorKm: lc[i].ev.poorKm, hard: lc[i].ev.hard, penalties: lc[i].ev.penalties };
        if (lc[i].ev && lc[i].ev.hard.length) { d.score -= 1000; d.hard = true; }   // a closed or private road: only if nothing else exists
        // how much of it is motorway or trunk, where the road class was known (the level charges it, FunRoute.loopHighwayCost)
        const hs = ApexRouteEngine.highwayShare(lc[i].ev);
        if (hs != null) d.hwyShare = hs;
      });
      // A time loop compares drive times: a route the router didn't time can't be judged with the others.
      if (L.targetS && done.some(d => Number.isFinite(d.t.timeS))) done = done.filter(d => Number.isFinite(d.t.timeS));
      for (const d of done) {                                             // how far off the asked length: the level weighs it
        const [got, want] = L.targetS && Number.isFinite(d.t.timeS) ? [d.t.timeS, L.targetS] : [d.km, L.targetKm];
        d.off = want ? (got - want) / want : 0;
      }
      // best first as the level ranks them (highway share charged, a dominated loop never ahead: FunRoute.loopRank)
      const byLevel = () => { done = FunRoute.loopRank(done.map(loopItem), LOOP_STYLE).map((x) => x.item.d); };
      byLevel();
      // Members: let what others measured break ties among the top few (rough −8 … smooth +3, banked ±2 on the same fun scale, docs/ROUTING.md; unmeasured roads are neutral).
      if (await applyMeasured(done.slice(0, 3), ui || { step() {} })) {
        for (const d of done) d.score += d.adjust || 0;
        byLevel();
      }
      await preferApply(done.slice(0, 4));                                   // the Prefer stamps (prefer.js)
      if (done.some(d => d.preferBonus)) { for (const d of done) d.score += d.preferBonus || 0; byLevel(); }
      // Name each loop by what it is, not what was asked: a "15 mi loop" that is 9.3 mi reads as a bug.
      for (const d of done) {
        d.t.request = { from: null, to: { lat: L.c.lat, lon: L.c.lon }, via: d.job.pts.slice(1, -1).map(p => ({ lat: p.lat, lon: p.lon, planned: true })) };
        d.t.name = L.targetS && Number.isFinite(d.t.timeS) ? `${Math.round(d.t.timeS / 60)} min loop` : `${Math.max(1, Math.round(ApexUnits.longN(d.km * 1000)))} ${ApexUnits.longU()} loop`;
      }
      return done;
    }
    /** The loops built and scored, the best on the map with its card and the note; resolves { o, best, done }, or null. */
    async function loopRound(L, jobs, ui, circleLast) {
      if (!jobs.length && circleLast) jobs = [loopCircle(L)];
      let done = jobs.length ? await loopBuilt(L, jobs, ui) : [];
      if (!done.length && circleLast && !jobs.some((j) => j.kind === 'circle')) done = await loopBuilt(L, [loopCircle(L)], ui);   // every plan failed: the last resort
      if (done.length) done = await loopScored(L, done, ui);
      if (!done.length) { if (circleLast) toast('Couldn\'t build a loop. Check signal and try again.'); return null; }
      // the best loop goes up; up to two others that head another way are offered beside it on the card (paintLoopWays)
      const o = loopOptions({ id: L.loopId, done, miles: L.miles, targetS: L.targetS, asked: L.asked });
      const best = o.list[o.picked].loop;
      ui.step('Building route', 0.92);
      routeOptions = Object.assign(o, { current: best.t });
      await buildRoute(null, L.loopId, best.t.name, best.t);
      if (window.ApexRouteCar) routeAftercare(best.lc);
      cardNote(loopNote(L, best, done.length));
      loopDebug(o, best);
      return { o, best, done };
    }
    function loopNote(L, best, n) {
      const gotMi = best.km / 1.609344;
      if (L.targetS && Number.isFinite(best.t.timeS)) {
        const gotMin = Math.round(best.t.timeS / 60), near = Math.abs(best.t.timeS - L.targetS) <= 0.2 * L.targetS;
        return (near ? `Best of ${n} loops found` : `${gotMin} min: the closest good loop to ${L.asked}`) + loopHwyNote(best);
      }
      const near = Math.abs(gotMi - L.miles) <= 0.2 * L.miles;
      return (near ? `Best of ${n} loops found` : `${ApexUnits.long(best.km * 1000)}: the closest good loop to ${L.asked}`) + loopHwyNote(best);
    }
    // Loops keep off the highways; the exception (no loop here without one) says how much it uses
    function loopHwyNote(best) {
      const km = Number.isFinite(best.hwyShare) && Number.isFinite(best.km) ? best.hwyShare * best.km : null;
      return FunRoute.LEVELS[LOOP_STYLE].noHighway && km != null && km > FunRoute.HWY.FREE_KM ? ` · uses ${ApexUnits.long(km * 1000, 1)} of highway (no loop here without it)` : '';
    }
    function loopDebug(o, best) {
      window.apexDebug && (window.apexDebug.lastLoop = o.ranked.map(({ item, v }) => ({ kind: item.d.job.kind, fun: item.d.t.fun && item.d.t.fun.fun, score: item.d.score, v, km: item.d.km, good: item.d.good,
        retraced: item.d.retraced, hwyShare: item.hwyShare, corners: item.corners, timeS: item.timeS, picked: item.d === best })));
    }
    // A built loop as FunRoute.loopRank reads it: the Fun score, the length off, highway share, the card's corners and time.
    const loopItem = (d) => ({ d, score: d.score, fun: d.t.fun, off: d.off, hwyShare: d.hwyShare, km: d.km, retraced: d.retraced, hard: !!d.hard,
      corners: Array.isArray(d.t.events) ? d.t.events.filter((e) => e && e.type === 'corner').length : null, timeS: d.t.timeS });

    // The loops built, ranked (fun_route.js loopRank) and offered as up to three really different ones: the best, then
    // loops that head another way (loopOffer). No level on a loop (LOOP_STYLE).
    let loopTuned = null;                                                  // the sliders the last loop's search used (buildLoop)
    function loopOptions({ id, done, miles, targetS, asked }) {
      for (const d of done) if (d && d.t && d.t.tuned === undefined) d.t.tuned = loopTuned;
      const order = FunRoute.loopRank(done.map((d) => ({ ...loopItem(d), way: FunRoute.loopWay(d.t) })), LOOP_STYLE);
      const list = FunRoute.loopOffer(order, 3).map(({ item }) => { const d = item.d;
        return { loop: d, t: d.t, timeS: d.t.timeS, fun: d.t.fun, way: item.way, route: { coords: d.t.lat.map((la, i) => [d.t.lon[i], la]) } }; });
      return { kind: 'loop', id, done, miles, targetS, asked, level: LOOP_STYLE, list, ranked: order, picked: 0 };
    }
    // Which way (the owner, 2026-11-10: a loop is aimless driving, not Quick / Fun / Long way): the loops found as cards,
    // each its outline, the way it heads, its time and corners (route_card.js loopCards). A tap puts that loop up; the
    // loops are built already, nothing is planned again. Hidden with one loop: nothing to choose.
    function paintLoopWays(t) {
      const box = $('routeCardWays'), o = routeOptions;
      if (!box || !window.ApexRouteCard) return;
      const cards = isLoop(t) && o && o.kind === 'loop' && o.current === t && state.mode !== 'live' ? ApexRouteCard.loopCards(o) : [];
      box.hidden = !cards.length;
      box.dataset.n = String(cards.length);
      const NS = 'http://www.w3.org/2000/svg';
      const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
      const part = (text, cls) => { const i = el('i', cls), m = /^(\S+) (\S+)$/.exec(text || ''); i.textContent = m ? m[1] : text; if (m) i.append(' ', el('small', '', m[2])); return i; };
      box.replaceChildren(...cards.map((k) => {
        const b = el('button'); b.type = 'button'; b.dataset.way = String(k.i); b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(k.on)); b.classList.toggle('on', k.on);
        b.setAttribute('aria-label', `Loop ${k.label === 'Around here' ? 'around here' : `to the ${k.label.toLowerCase()}`}: ${k.time === '--' ? 'time --' : k.time}, ${k.corners === '--' ? 'corners --' : k.corners}`);
        if (k.outline) {
          const svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path'), dot = document.createElementNS(NS, 'circle');
          svg.setAttribute('viewBox', `0 0 ${k.outline.w} ${k.outline.h}`); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'rc-way-art');
          path.setAttribute('d', k.outline.d); dot.setAttribute('cx', k.outline.start[0]); dot.setAttribute('cy', k.outline.start[1]); dot.setAttribute('r', '2.6');
          svg.append(path, dot); b.append(svg);
        }
        const lv = el('span', 'rc-lv'); lv.append(part(k.time), part(k.corners, 'rc-lv-c'));
        b.append(el('b', '', k.label), lv);
        b.addEventListener('click', () => pickOption(k.i));
        return b;
      }));
    }
    // The loop card's length (finding 6): the dial's five lengths, in your units; a tap builds a loop of that length.
    function paintCardLoop(t) {
      const box = $('routeCardLoop'), on = isLoop(t) && state.mode !== 'live';
      box.hidden = !on;
      if (!on) return;
      const o = routeOptions && routeOptions.kind === 'loop' && routeOptions.current === t ? routeOptions : null;
      const time = loopBy === 'time';
      box.setAttribute('aria-label', time ? 'Loop time' : 'Loop length');
      box.querySelector('.rc-loop-label').textContent = time ? 'Time' : 'Length';
      const keys = [...document.querySelectorAll('#loopDetents button')];
      const row = $('cardLoopDetents'), id = (k) => (k.dataset.loopMin ? `${k.dataset.loopMin}min` : k.dataset.loopMi);
      if (row.children.length !== keys.length || keys.some((k, i) => row.children[i].textContent !== k.textContent || row.children[i].dataset.cardLoop !== id(k))) {
        row.replaceChildren(...keys.map((k) => { const b = document.createElement('button'); b.textContent = k.textContent; b.dataset.cardLoop = id(k);
          b.setAttribute('aria-label', `A ${k.textContent} loop`);
          b.addEventListener('click', () => { if (loopBusy) return; pickLoop(k); loop(k.dataset.loopMin ? { minutes: parseInt(k.dataset.loopMin, 10) } : parseFloat(k.dataset.loopMi), b); }); return b; }));
      }
      keys.forEach((k, i) => row.children[i].setAttribute('aria-pressed', String(!!o && (k.dataset.loopMin ? o.targetS === parseInt(k.dataset.loopMin, 10) * 60 : !o.targetS && Math.abs(parseFloat(k.dataset.loopMi) - o.miles) < 0.01))));
    }

    // Explore (R-10): the best roads within N minutes of here, as a list and on the map; one tap drives one (to its far
    // end, through the whole stage). Roads come from the same stage discovery as loops; the matrix gives real drive times.
    const EXPLORE_KMH = 45;   // search radius per minute of driving, crow fly (capped by the 64-tile search)
    async function exploreNear(minutes, btn) {
      if (loopBusy || state.mode === 'live' || $('planPanel').classList.contains('busy')) return;
      loopBusy = true;
      const panel = planBusy(), was = plannedRoute;                 // a destination typed meanwhile waits, not races
      const key = busy(btn, [...document.querySelectorAll('[data-loop-mi], [data-loop-min], [data-explore-min]')]);
      // the key you chose stays "Within 15 min" while it works (it turned into "Finding roads" over a line saying the same)
      const ui = { step(text, f) { key.progress(f); nearbyStatus(`${text}…`, true); }, done() { key.done(); } };
      $('exploreList').hidden = true;
      try {
        const c = await locate();
        if (!c) { toast(NO_FIX); return; }
        const maxKm = Math.min(14, minutes / 60 * EXPLORE_KMH);
        const hls = state.hlOn ? await allHighlights(c) : [];
        const inReach = (s) => Math.min(FunRoute.kmBetween(c, { lat: s.lat[0], lon: s.lon[0] }), FunRoute.kmBetween(c, { lat: s.lat[s.lat.length - 1], lon: s.lon[s.lon.length - 1] })) <= maxKm;
        // our tiles first (graph_router.js explore: the best-scored edges chained into stages, the drive time to each end
        // from one search), ranked by the engine on the tiles' own road data; no tiles here or any failure: the map's
        // vector tiles and Valhalla's matrix, as before
        let own = null;
        if (ownOn() && !state.hlOn) {
          try {
            if (await RouteLoading.optional(ownRouter().covers([c]), OWN_COVERS_MS)) {
              ui.step('Finding roads', 0.3);
              const res = await ownRouter().explore({ start: { lat: c.lat, lon: c.lon }, maxKm, maxS: minutes * 60, prefs: searchPrefs() });
              if (res && res.stages && res.stages.length) own = await stagesWithContext(res.stages, 12, ['graph', 'context_grid']);
            }
          } catch (_) { own = null; }
          if (window.apexDebug) window.apexDebug.lastExploreOwn = own ? own.length : 0;
        }
        const stages = own || await ApexStages.discover(c, maxKm, (phase, f) => ui.step(phase === 'tiles' ? 'Finding roads' : 'Scoring roads', 0.1 + 0.6 * f),
          { names: inReach, prefs: searchPrefs(), ...(state.hlOn ? { highlights: hls, strength: state.hlStrength } : {}) }).then((st) => measuredStages(st, c, maxKm)).then((st) => stagesWithContext(st, 12));
        const list = FunRoute.exploreShortlist(c, stages, maxKm, 12);   // 24 matrix pairs; most fall to the time limit
        ui.step('Measuring roads', 0.8);
        // ours carry their drive times (aS, bS); the map's stages (highlights on, or no tiles here) are timed on our tiles
        // where they cover you (graph_router.js times: no network), else by Valhalla's matrix
        const ownTimes = async (targets) => {
          if (!ownOn()) return null;
          try {
            if (!(await RouteLoading.optional(ownRouter().covers([c]), OWN_COVERS_MS))) return null;
            const r = await ownRouter().times({ start: { lat: c.lat, lon: c.lon }, targets, maxKm, maxS: minutes * 60 });
            return r && Array.isArray(r.times) && r.times.length === targets.length ? { times: [r.times], own: true } : null;
          } catch (_) { return null; }
        };
        const m = own ? { times: [list.flatMap((s) => [s.aS, s.bS])] } : list.length
          ? (await ownTimes(FunRoute.exploreTargets(list))) || await valhallaMatrix([c], FunRoute.exploreTargets(list)) : { times: [[]] };
        if (window.apexDebug) window.apexDebug.lastExploreTimes = own ? 'own stages' : !list.length ? 'none' : m.own ? 'own' : 'matrix';
        if (state.mode === 'live') return;                            // driving now: too late
        if (plannedRoute && plannedRoute !== was) { toast('Explore cancelled: a route is up.'); return; }
        const picks = FunRoute.explorePicks(list, m.times, minutes * 60);
        showExplore({ here: c, minutes, picks, at: Date.now() });
        nearbyStatus(picks.length ? `${picks.length} good ${picks.length === 1 ? 'road' : 'roads'} within ${minutes} min. Tap one to plan it.` : `No good roads within ${minutes} min of here.`);   // its own status line, heard by screen readers
      } catch (_) { nearbyStatus('Couldn\'t look for roads here. Check signal and try again.'); }
      finally { loopBusy = false; ui.done(); panel.done(); }
    }
    // A bare route number from the tiles' ref reads as a count: "282" → "Route 282".
    const roadLabel = (name) => (!name ? 'Road name unknown' : /^\d+[A-Z]?$/.test(name) ? `Route ${name}` : name);
    function showExplore(e) {
      explore = e || null;                                          // up, with or without picks, until a route or ✕
      const box = $('exploreList');
      paintExplore();
      if (!e) { box.hidden = true; box.replaceChildren(); return; }
      lastExplore = e;
      // finding 7: every number under a named column, its unit beside it: no bare "10 · 2.1 mi · 9 min"
      const cells = (name, good, len, away) => { const g = document.createElement('span'); g.className = 'nb-cells'; g.append(name, good, len, away); return g; };
      const span = (text, unit) => { const x = document.createElement('span'); x.textContent = text; if (unit) { const u = document.createElement('small'); u.textContent = unit; x.append(u); } return x; };
      const head = document.createElement('div'); head.className = 'nb-head'; head.setAttribute('aria-hidden', 'true');
      head.append(cells(span('Road'), span('Good corners'), span('Length'), span('Drive there')), span(''));
      const rows = e.picks.map((p, i) => {
        const b = document.createElement('button'); b.className = 'nb-go';
        const name = document.createElement('b'); name.textContent = roadLabel(p.s.name);
        const [lv, ...lu] = ApexUnits.long((p.s.km) * 1000, 1).split(' '), away = Math.max(1, Math.round(p.awayS / 60));
        b.append(cells(name, span(String(p.s.good)), span(lv, lu.join(' ')), span(String(away), 'min')));
        b.setAttribute('aria-label', `${name.textContent}: ${p.s.good} good corners, ${lv} ${lu.join(' ')} long, ${away} minutes to drive there. Plan it.`);
        b.addEventListener('click', () => driveStage(i));
        // what the road is like (road_page.js, IDEAS Q-13)
        const about = document.createElement('button'); about.className = 'linkbtn'; about.textContent = 'About';
        about.setAttribute('aria-label', `About ${name.textContent}`);
        about.addEventListener('click', () => openRoadPage(p.s, () => driveStage(i)));
        const row = document.createElement('div'); row.className = 'nb-row'; row.append(b, about);
        return row;
      });
      box.replaceChildren(...(e.picks.length ? [head, ...rows] : []));
      box.hidden = !e.picks.length;
      if (e.picks.length && mapReady && state.mode !== 'live') {
        let w = e.here.lon, ea = e.here.lon, so = e.here.lat, n = e.here.lat;
        for (const p of e.picks) for (let i = 0; i < p.s.lat.length; i += 10) { w = Math.min(w, p.s.lon[i]); ea = Math.max(ea, p.s.lon[i]); so = Math.min(so, p.s.lat[i]); n = Math.max(n, p.s.lat[i]); }
        pauseFollow();
        // Fit the roads into the map left above the sheet (Best roads nearby's, or the plan's).
        const top = $('nearbySheet').classList.contains('open') ? $('nearbySheet').getBoundingClientRect().top : $('planPanel').getBoundingClientRect().top, bottom = Math.max(24, Math.min(window.innerHeight - 160, window.innerHeight - top + 16));
        const sv = viewInsets();
        map.fitBounds([[w, so], [ea, n]], { padding: { top: sv.t + 40, left: sv.l + 30, right: sv.r + 30, bottom }, pitch: 0, bearing: 0, duration: 1000 });
      }
    }
    let lastExplore = null;
    function nearbyStatus(text, busyNow = false) { const n = $('nearbyStatus'); n.textContent = text || ''; n.className = 'rc-progress' + (text ? (busyNow ? ' busy' : ' found') : ''); }
    // finding 7: Best roads nearby opens its list sheet and looks at once (or shows the last look, from the last 10 minutes)
    function openNearby() {
      if (state.mode === 'live' || driveActive) return;
      closeOptions(true);
      const sheet = $('nearbySheet');
      sheet.classList.add('open');
      const pick = sheet.querySelector('[data-explore-min][aria-pressed="true"]') || sheet.querySelector('[data-explore-min]');
      const fresh = lastExplore && Date.now() - lastExplore.at < 10 * 60000 && lastExplore.minutes === parseInt(pick.dataset.exploreMin, 10);
      if (fresh) { if (!explore) showExplore(lastExplore); }
      else if (!loopBusy) exploreNear(parseInt(pick.dataset.exploreMin, 10), pick);
      requestAnimationFrame(() => $('nearbyClose').focus());
    }
    function closeNearby() {
      const sheet = $('nearbySheet');
      if (!sheet.classList.contains('open')) return;
      sheet.classList.remove('open');
    }
    // Road page (road_page.js, IDEAS Q-13): the reference lap over the road's shape, the DEM's climb, members' measurements.
    let roadPop = null;
    // go: plan this road (the list's own row tap), so the page is not a dead end you have to Close out of
    async function openRoadPage(s, go) {
      if (!window.ApexRoadPage) return;
      if (!roadPop) {
        roadPop = document.createElement('aside'); roadPop.className = 'side-pop'; roadPop.setAttribute('role', 'dialog'); roadPop.setAttribute('aria-label', 'About this road');
        document.body.append(roadPop);
      }
      const head = document.createElement('div'); head.className = 'side-pop-head';
      const h = document.createElement('h3'), close = document.createElement('button');
      h.textContent = roadLabel(s.name); close.className = 'linkbtn'; close.textContent = 'Close'; close.addEventListener('click', () => roadPop.classList.remove('open'));
      head.append(h, close);
      const body = document.createElement('div'); body.className = 'stack-8 road-page';
      const note = (t) => { const p = document.createElement('p'); p.className = 'note'; p.textContent = t; return p; };
      const bar = [];
      if (go) {
        const key = document.createElement('button'); key.className = 'find-key'; key.textContent = 'Plan this road';
        key.addEventListener('click', () => { roadPop.classList.remove('open'); go(); });
        const d = document.createElement('div'); d.className = 'rp-go'; d.append(key); bar.push(d);
      }
      roadPop.replaceChildren(head, body, ...bar); roadPop.classList.add('open');
      let onRoad = [];   // ApexRoadPage.hazardFacts: what members felt and reported on it, once looked up
      const paint = (d) => {
        if (!d) { body.replaceChildren(note('Too short to describe.')); return; }
        const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
        // each score: its name and what it means, the number, and a bar that is empty when the score isn't known
        const meters = ApexRoadPage.meters(d).map((m) => {
          const r = el('div', 'rp-meter'), bar = el('i', 'rp-bar'), fill = el('i');
          fill.style.width = `${m.value == null ? 0 : m.value}%`; bar.append(fill);
          r.append(el('span', 'rp-name', m.label), el('b', '', m.value == null ? '--' : String(m.value)), bar, el('small', '', m.hint));
          r.setAttribute('role', 'group'); r.setAttribute('aria-label', `${m.label}: ${m.value == null ? 'not known' : `${m.value} out of 100`}, ${m.hint}`);
          return r;
        });
        const lines = [...meters, ...[...ApexRoadPage.facts(d), ...onRoad].map(([k, v]) => { const r = el('div', 'rp-fact'); r.append(el('span', '', k), el('b', '', v)); return r; })];
        const best = Number.isFinite(s.elevA) && Number.isFinite(s.elevB) && Math.abs(s.elevB - s.elevA) >= 40
          ? ((s.tight || 0) / s.km >= 1.2 ? 'Better climbed: tight corners are safer uphill.' : 'Better descended: it flows.') : null;
        // the climb is a height (feet or metres, heightLabel); ApexUnits.short is an object and printed "[object Object]"
        const head = note(ApexRoadPage.headline(d, (km) => ApexUnits.long(km * 1000, 1), heightLabel)); head.classList.add('rp-head');
        body.replaceChildren(head, ...lines,
          ...(best ? [note(best)] : []), note('Read from the map\'s shape and terrain, as a careful driver would take it. Never a speed to aim for.'));
      };
      const rs = Core.resamplePolyline(s.lat, s.lon, 5), dist = rs.lat.map((_, i) => i * 5);
      const side = (() => { try { return ApexDrivingSide.forRoute(rs.lat[0], rs.lon[0]); } catch (_) { return null; } })();
      paint(ApexRoadPage.describe(Core, s, { side }));                // straight away from the shape; then with the terrain and members' data
      let elev = null, measured = null, reports = null;
      const member = window.ApexSync ? await RouteLoading.optional(ApexSync.member(), 4000).catch(() => null) : null;
      // live hand reports round the road's middle (by cell, VI-1), wide enough for the whole road
      const reportsP = member ? (async () => {
        const mid = Math.floor(rs.lat.length / 2), km = Math.min(50, Math.max(2, Math.ceil(rs.lat.length * 5 / 2000) + 1));
        const r = await RouteLoading.optional(ApexSync.apiFetch(`/api/hazards?${ApexPrivacyZones.cellQuery(rs.lat[mid], rs.lon[mid], km)}`, { method: 'GET' }), 6000);
        const j = r && r.ok ? await r.json() : null;
        return Array.isArray(j) ? j : null;
      })().catch(() => null) : Promise.resolve(null);
      try { elev = await RouteLoading.optional(ApexStages.profile({ lat: rs.lat, lon: rs.lon, dist }, 30), 6000); } catch (_) { elev = null; }
      try {
        if (window.ApexContributor && member)
          measured = await RouteLoading.optional(ApexContributor.measuredAlong({ lat: rs.lat, lon: rs.lon }, async (ids) => { const r = await apiCall('GET', `/api/roads?ways=${ids.join(',')}`); return r.ok ? r.json() : null; }), 12000);
      } catch (_) { measured = null; }
      reports = await reportsP;
      if (!roadPop.classList.contains('open') || h.textContent !== roadLabel(s.name)) return;
      onRoad = ApexRoadPage.hazardFacts(ApexRoadPage.onThisRoad(rs, measured, reports), (m) => ApexUnits.long(m, 1));
      paint(ApexRoadPage.describe(Core, s, { side, elev, measured, surf: window.ApexContributor ? ApexContributor.surfaceScore(measured) : null }));
    }
    function paintExplore() {
      if (!mapReady || !map.getSource('apex-explore-src')) return;
      map.getSource('apex-explore-src').setData(explore && explore.picks.length && state.mode !== 'live' ? { type: 'FeatureCollection', features: explore.picks.map((p, i) => ({ type: 'Feature', properties: { i },
        geometry: { type: 'LineString', coordinates: p.s.lat.map((la, k) => [p.s.lon[k], la]) } })) } : emptyFC());
    }
    async function driveStage(i) {
      const e = explore, p = e && e.picks[i];
      if (!p || loopBusy || optionBusy || state.mode === 'live' || $('planPanel').classList.contains('busy')) return;
      loopBusy = true;
      closeNearby();
      const ui = planBusy();
      try {
        ui.step('Routing…');
        const from = (await locate()) || e.here;
        // From here to the stage's near end, then through its middle to the far end (shaping points keep it on the stage).
        const pts = ApexStages.waypoints(from, { legs: [{ s: p.s, fwd: p.fwd }] }).slice(0, -1);
        const [r] = await routePoints(pts);
        if (explore !== e) return;                                  // cleared meanwhile
        const name = roadLabel(p.s.name), end = pts[pts.length - 1];
        const t = await trackFromPolyline(r.coords, 'explore', name);
        if (explore !== e || state.mode === 'live') return;         // cleared, or a drive started, while routing
        const glare = FunRoute.glare(t, r.timeS, new Date(leaveAt()));
        Object.assign(t, { fun: funOf(t, r.turns), timeS: r.timeS, timeMarks: timeMarksOf(t, r), steps: stepsOf(t, r), unavoided: FunRoute.unavoided(avoid, r), glareMin: glare ? Math.round(glare.minutes) : null,
                           request: { from: null, to: { lat: end.lat, lon: end.lon }, via: pts.slice(1, -1).map(q => ({ lat: q.lat, lon: q.lon, shaping: true })) } });
        ownInstructLater(t, r);
        await buildRoute(null, 'explore', name, t);
        cardNote(`${name}: ${Math.max(1, Math.round(p.awayS / 60))} min to the start, then ${ApexUnits.long((p.s.km) * 1000, 1)} of it`);
      } catch (_) { toast('Couldn\'t route to that road. Try another.'); }
      finally { loopBusy = false; ui.done(); }
    }

    // =======================================================================
    // 10. UI WIRING
    // =======================================================================
    function toast(msg, action) {
      const t = $('toast');
      // while a request made on the car runs (carAsked), what the phone says back is said on the car too: a loop or a
      // place that couldn't be planned left the car silent, the reason only on the phone in the driver's pocket
      if (car.echo > 0 && !action && window.ApexCarPlay) carPost(ApexCarPlay.noticeMessage(msg));
      // U-74 / U-102 (check): in a drive a plain message is the status line's, under the record line, never a toast over the
      // map and its next corner (so a Cancel countdown in the toast doesn't swallow it); one with an action still needs the
      // toast's key
      if (!action && !$('driveBar').hidden) { driveNote(msg); return; }   // the drive bar is up exactly while a drive screen is
      if (!action && t._holdUntil > performance.now()) return;   // a Cancel countdown owns the toast until it ends
      t._holdUntil = action && action.ms ? performance.now() + action.ms : 0;
      t.textContent = msg;
      // A message with a key is a row: the words on the left, the key whole on the right (.toast.has-key). The key was an
      // inline link in the red pen; when the words wrapped it dropped under them, indented.
      t.classList.toggle('has-key', !!action);
      if (action) {
        const a = document.createElement('a'); a.href = action.href || '#'; a.textContent = action.label; a.className = 'toast-key'; t.append(a);
        // Once the countdown is over the action is gone: a late tap must not undo what already happened.
        if (action.onClick) a.onclick = (e) => { e.preventDefault(); if (!a.isConnected) return; t._holdUntil = 0; a.remove(); action.onClick(); t.classList.remove('show'); };
      }
      t.classList.add('show'); clearTimeout(t._h);
      t._h = setTimeout(() => { t.classList.remove('show'); if (action && action.onClick) t.querySelectorAll('a').forEach(x => x.remove()); }, action ? action.ms || 7000 : 4200);
    }
    // The server hit Workers Free's daily limit (sync.js 'apex:server-down', until midnight UTC): said once, held 10 s so the
    // "Couldn't ... Try again" lines that follow don't hide it. Driving, notes and routes don't need our server.
    // Near the month's included usage (scope 'uploads', backend src/usage.ts) only road uploads and photos wait, until the 1st.
    window.addEventListener('apex:server-down', (e) => {
      const d = (e && e.detail) || {}, until = d.until;
      if (d.scope === 'uploads') {
        const day = Number.isFinite(until) ? new Date(until).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null;
        toast(`Uploads and photos are paused${day ? ` until ${day}` : ''}: our server is near its monthly limit. Everything else still works.`, { label: 'OK', ms: 10000, onClick: () => {} });
        return;
      }
      const at = Number.isFinite(until) ? new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
      toast(`Sharing is down${at ? ` until ${at}` : ' for today'}: our server hit its daily limit. Driving and notes still work.`, { label: 'OK', ms: 10000, onClick: () => {} });
    });
    // A failed request reads as the browser's own words ("Load failed", "Failed to fetch", "NetworkError when attempting to
    // fetch resource.", a bad JSON parse); the driver gets one plain line instead. Our own messages (NO_FIX, "Couldn't find
    // that place") pass through as written.
    function errText(err) {
      const m = String((err && err.message) || err || '');
      if (!m) return 'Something went wrong. Try again.';
      if (/load failed|failed to fetch|networkerror|network connection|the internet connection|timed? ?out/i.test(m)) return 'No connection. Try again when you have signal.';
      if ((err && err.name === 'SyntaxError') || /unexpected token|JSON/i.test(m)) return 'Something went wrong on our side. Try again in a moment.';
      return m;
    }
    // A drive's one-key offer (Go round, Skip, Head home) is on the car's screen too, as a navigation alert with the key and
    // Not now (CarPlay/ApexCarPlay.swift showOffer): whichever key is tapped first does it, once, and the other goes away.
    function offerKey(msg, short, action) {
      const id = `o${++car.offerSerial}`;
      let done = false;
      const once = (fromCar) => {
        if (done) return;
        done = true; car.offer = null;
        if (fromCar) { if (key && key.isConnected) { key.remove(); $('toast')._holdUntil = 0; $('toast').classList.remove('show'); } }
        else carPost({ kind: 'offerDone', id });
        action.onClick();
      };
      toast(msg, { ...action, onClick: () => once(false) });
      const key = $('toast').querySelector('a.toast-key');
      car.offer = { id, until: performance.now() + (action.ms || 7000), run: () => once(true) };
      carPost(ApexCarPlay.offerMessage(id, msg, short, action.label, action.ms));
    }
    // Something that needs an account says so and offers the way in: the toast's "Sign in" key opens People, where signing in
    // lives. In a drive it is only said, on the drive's message row: no sheet opens over the road.
    function askSignIn(why) {
      const msg = `Sign in to ${why}.`;
      if (!$('driveBar').hidden) { driveNote(msg); return; }
      toast(msg, { label: 'Sign in', onClick: () => showView('friends') });
    }
    // The drive's message row: the whole message if it fits beside Report and End, else its first sentence ("Gravel
    // reported."), never a word cut in half; VoiceOver is read all of it. It goes after DRIVE_NOTE_MS.
    const DRIVE_NOTE_MS = 6000;
    // opts.alarm: the Sight warning's sentence (sightAlarm), in the signal colour with its mark; opts.ms: how long it stays
    function driveNote(msg, opts = {}) {
      const n = $('dsNote');
      clearTimeout(n._h);
      n.classList.toggle('alarm', !!opts.alarm);
      n.hidden = false; n.textContent = msg; n.setAttribute('aria-label', msg);
      const first = (msg.match(/^.+?[.!?](?=\s|$)/) || [msg])[0];
      if (n.scrollWidth > n.clientWidth + 1 && first !== msg && first.split(' ').length >= 2) { n.textContent = first; announce(msg); }
      n._h = setTimeout(() => { n.hidden = true; n.textContent = ''; n.removeAttribute('aria-label'); n.classList.remove('alarm'); }, opts.ms || DRIVE_NOTE_MS);
    }
    // Views: ROUTE / DRIVES / SETUP open the side panel; tapping the open tab again, the map
    // behind it, or swiping it right closes it. ANALYSIS is its own page.
    const LEGAL_SITE = 'https://vettadrive.com';   // the published privacy and terms pages (web/privacy.html, web/terms.html)
    const VIEW_TITLES = { people: 'People', garage: 'Garage' };
    // People (the owner, 2026-10-30): one tab, two sides; 'crew' (old links, a convoy invite) opens its Crews side.
    const PEOPLE_SIDES = { friends: 'friends', crew: 'crews', crews: 'crews' };
    let view = null, inviteOpen = false, peopleSide = 'friends';           // inviteOpen: the Friends side's Invite sheet
    function setPeopleSide(side) {
      const next = side === 'crews' ? 'crews' : 'friends';
      if (next !== peopleSide) { inviteOpen = false; document.querySelectorAll('.side-pop.open').forEach(n => n.classList.remove('open')); }   // a sheet belongs to its side
      peopleSide = next;
      $('accountBody').hidden = next !== 'friends'; $('crewsBody').hidden = next !== 'crews';
      document.querySelectorAll('[data-people]').forEach((b) => { const on = b.dataset.people === next; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      $('sheet').querySelector('.body').scrollTop = 0;
      if (next === 'friends' && view === 'people') try { if (inbox) inbox.markSeen(); } catch (_) {}
    }
    const logFrame = { el: null, url: null, pending: new Set(), want: null };   // the Log's frame (below, F-15)
    function showView(v) {
      if (v) $('endCard').classList.remove('show');                    // R-5 / I-6: a tab never opens under the drive's card
      if (v === 'log') { openLog('analysis.html?tab=log'); return; }
      if (v === 'stages') { openLog('analysis.html?tab=stages'); return; }
      logFrame.want = null;                                            // another tab while the Log was loading: it stays closed
      if (v === 'setup') v = 'garage';                                   // Settings live in the Garage now (REVIEW.md roadmap 9)
      if (v === 'route') { showView(null); openPlan(true); return; }
      if (v === 'map') v = null;
      if (PEOPLE_SIDES[v]) { setPeopleSide(PEOPLE_SIDES[v]); v = 'people'; }
      if ((v === 'people' || v === 'garage') && !socialIn) needSocial();   // F-03: their modules, on first use
      if (v !== 'people') { inviteOpen = false; document.querySelectorAll('.side-pop.open').forEach(n => n.classList.remove('open')); }
      view = v;
      if (v) openPlan(false);
      const sheet = $('sheet');
      if (v) { sheet.dataset.view = v; $('sheetTitle').textContent = VIEW_TITLES[v]; sheet.querySelector('.body').scrollTop = 0; }
      sheet.classList.toggle('open', !!v);
      $('app').classList.toggle('sheet-open', !!v);
      $('scrim').classList.toggle('show', !!v);
      document.querySelectorAll('#tabbar .tab').forEach(t => t.classList.toggle('on', v ? t.dataset.view === v : t.dataset.view === 'map'));
      if (v === 'people' && peopleSide === 'friends') try { if (inbox) inbox.markSeen(); } catch (_) {}   // For you on screen: seen
      if (v === 'garage') try { shelveLooks(); } catch (_) { /* before the picker is built */ }   // the looks' shelf turns to the one in use (not at boot)
    }
    const openSheet = (v = view || 'route') => showView(v);
    // The Log and Stages (analysis.html) open in a full-screen frame over the map, never in its place (the owner,
    // 2026-10-29: no page reloads): the map, a drive in progress and the car's screen keep running behind it, and its
    // Map, People and Garage tabs close the frame (web/page_return.js). F-15 (REVIEW_FEEL): the frame is loaded once, hidden,
    // when the map is idle after launch, and never again: a different page of the Log, a new or changed drive, the theme and
    // the units are messages to it (analysis.html ApexLogFrame), so opening the Log is showing a page that is already there.
    function safeInsets() {
      let probe = $('saProbe');
      if (!probe) { probe = el('div', { id: 'saProbe' }); probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'; document.body.append(probe); }
      const cs = getComputedStyle(probe);
      return { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft };
    }
    function logInsets() {
      const ins = safeInsets();
      try { const st = logFrame.el.contentDocument.documentElement.style; for (const k of Object.keys(ins)) st.setProperty(`--sa-${k}`, ins[k]); } catch (_) {}
    }
    // the Log page's own interface once it has loaded (analysis.html), else null
    const logApi = () => { try { return (logFrame.el && logFrame.el.contentWindow && logFrame.el.contentWindow.ApexLogFrame) || null; } catch (_) { return null; } };
    function logFrameEl(url) {
      let f = logFrame.el;
      if (f) return f;
      f = logFrame.el = el('iframe', { id: 'logFrame', title: 'Log' });
      f.hidden = true;
      f.addEventListener('load', () => {                              // a fresh page reads everything itself
        logInsets(); logFrame.pending.clear();
        const want = logFrame.want; logFrame.want = null;
        if (want && state.mode !== 'live') openLog(want);              // asked for while it loaded: shown now, whole
      });
      logFrame.url = url; f.src = url;
      document.body.append(f);
      return f;
    }
    function openLog(url) {
      $('endCard').classList.remove('show');                           // R-5 / I-6: the Log takes the screen, not under the card
      const f = logFrameEl(url), api = logApi();
      if (api) {
        for (const what of logFrame.pending) api.changed(what);         // what changed while it was hidden, said once each
        logFrame.pending.clear();
        api.open(url);                                                  // the page asked for, in place (never a reload)
        logFrame.url = url;
        logInsets();
      } else {
        // still loading (a Log tapped in the first seconds of a fresh install): the frame stays hidden until its page is there,
        // so the map and its tabs stay usable, rather than a blank full screen with no way out for seconds (walkthrough
        // 2026-11-11: 4 s of empty paper over the tab bar); it opens on its own when it has loaded, unless another tab was asked
        if (logFrame.url !== url) { logFrame.url = url; f.src = url; }  // load the page asked for instead
        if (!logFrame.want) toast('Opening your Log…');
        logFrame.want = url;
        return;
      }
      f.hidden = false;
      document.documentElement.classList.add('log-open');
      if (api) api.shown();
    }
    // F-15: the Log is loaded while nothing else is happening (the map idle, no drive), so its first open is a show
    function prewarmLog() {
      if (logFrame.el || state.mode === 'live' || driveActive || document.hidden) return;
      // never while a route is planned or just after (its 40 scripts are parsed on the page's thread: live 2026-11-08 the
      // frame loaded 1.5 s into a plan): again once the plan is over
      const planAt = window.apexDebug && window.apexDebug.planStartAt, busy = $('planPanel').classList.contains('busy');
      if (busy || (planAt != null && performance.now() - planAt < 4000)) { setTimeout(() => idle(prewarmLog), 3000); return; }
      // the website with no signal: its scripts can't be fetched, and a Log loaded half (no ApexCore) would be the one kept;
      // again once back online (the app's own files are on the phone: it warms either way)
      if (/^https?:$/.test(location.protocol) && navigator.onLine === false) { window.addEventListener('online', () => idle(prewarmLog), { once: true }); return; }
      logFrameEl('analysis.html?tab=log');
    }
    window.addEventListener('resize', () => { if (logFrame.el && !logFrame.el.hidden) logInsets(); });
    const postable = (date) => { const t = Date.parse(date); return Number.isFinite(t) && t <= Date.now() + 86400e3 && t >= Date.now() - 29 * 86400e3; };
    window.ApexLogHost = {
      close(v) {
        refreshSavedDrives().catch(() => {});                          // a drive renamed or deleted in the Log
        if (logFrame.el) logFrame.el.hidden = true;
        document.documentElement.classList.remove('log-open');
        const api = logApi(); if (api) api.hidden();
        showView(VIEW_TITLES[v] || PEOPLE_SIDES[v] ? v : null);
      },
      load(url) {                                                      // a replay: the map page loads with that drive
        const again = (() => { try { return new URL(url, location.href).searchParams.get('again'); } catch (_) { return null; } })();
        if (again) { ApexLogHost.close('map'); driveAgain(again); return; }   // panel D-1: Drive it again plans in place
        // a friend's handle on the Log: People, on their profile, without reloading the map page
        const friend = (() => { try { return new URL(url, location.href).searchParams.get('friend'); } catch (_) { return null; } })();
        if (friend && window.apexOpenFriend) { window.apexOpenFriend(String(friend).toLowerCase()); ApexLogHost.close('friends'); return; }
        location.href = url;
      },
      // 'drives' | 'theme' | 'units': told now when the Log is showing, else when it is next opened
      changed(what) {
        const api = logApi();
        if (api && logFrame.el && !logFrame.el.hidden) api.changed(what); else if (logFrame.el) logFrame.pending.add(what);
      },
      stale() { ['drives', 'theme', 'units'].forEach((w) => ApexLogHost.changed(w)); },
      insets: () => safeInsets(),                                      // asked for by the frame as its first script runs
      // a corner clip made on the Log, to your friends or a crew (drive_posts.js compose, its sheet on this page): for a
      // member. The Log steps aside while the sheet shows; what the sheet said (posted, or the clip didn't go up) is handed
      // back for the Log to say, since this page's toast is under it. { posted, said }
      // date: the drive's (a post is of a drive from the last 30 days, backend drive_posts.ts)
      canPost: (date) => !!(accountMe && accountMe.member) && (date === undefined || postable(date)),
      async post(blob, meta = {}) {
        if (!blob || !(accountMe && accountMe.member)) return { posted: false, said: 'Sign in to post.' };
        try { await needSocial(); } catch (_) {}
        const rec = meta.driveId && window.ApexRecording ? await ApexRecording.get(meta.driveId).catch(() => null) : null;
        if (!drivePosts || !rec) return { posted: false, said: 'Couldn’t post it here.' };
        let score = null;
        try { const sum = ApexRecording.summarize(ApexCore, rec); score = sum && sum.ds ? sum.ds.score : null; } catch (_) { score = null; }
        if (rec.date_known === false || !postable(rec.date)) return { posted: false, said: 'Only drives from the last 30 days can be posted.' };
        const dt = new Date(rec.date), day = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        const len = Array.isArray(rec.dist) && rec.dist.length ? rec.dist[rec.dist.length - 1] : null;
        const d = { name: rec.name, driven_on: day, len_m: len, score, lat: rec.lat, lon: rec.lon, roads: Array.isArray(rec.roads) ? rec.roads : [],
          media: { blob, mime: String(meta.mime || blob.type || 'video/mp4').split(';')[0], label: String(meta.cornerLabel || '').slice(0, 60) || null } };
        const f = logFrame.el, shown = !!(f && !f.hidden), t = $('toast');
        if (shown) f.hidden = true;
        const before = t.textContent;
        let posted = false;
        try { posted = !!(await drivePosts.compose(d)); } finally { if (shown) f.hidden = false; }
        const said = posted && t.classList.contains('show') && t.textContent !== before ? t.textContent : (posted ? 'Posted.' : '');
        if (posted) { t.classList.remove('show'); pushOffer(); }
        return { posted, said };
      },
    };
    // links into the Log anywhere on the map page (the drive-ended card, a toast's Open) open the frame too
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href^="analysis.html"]') : null;
      if (!a || e.defaultPrevented) return;
      e.preventDefault(); openLog(a.getAttribute('href'));
    });
    // Plan: the bar is always there (not while driving); tap it, or drag it up, for From / To, places, loops and the route card.
    // R-5 (panel round 1): the bar's height, measured only while it is laid out. A drive hides the deck (#app.live) and then
    // closes it, which measured 0 and parked the deck 2 px tall behind the tab bar for good: Where to? and Start were gone
    // after a car-started drive (free-drive/phone/021).
    function measurePlanBar() {
      const h = $('planBar').offsetHeight;
      if (!h) return;
      $('planPanel').style.setProperty('--plan-bar', `${h + 2}px`); document.documentElement.style.setProperty('--plan-bar', `${h + 2}px`);   // the floating loop (landscape) sits above it
    }
    // Where to?'s time attack row says this week's loop and your place before it is opened (time_attack.js peek): only
    // the area goes, and not from inside a privacy zone or before a drive's private edge (nearLookupOk)
    function peekTimeAttack() {
      try {
        if (!timeAttack || $('planAttack').hidden || !(accountMe && accountMe.member)) return;
        const p = state.lastPosition || (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })();
        if (nearLookupOk(p)) timeAttack.peek().catch(() => {});
      } catch (_) {}
    }
    function openPlan(open) {
      const panel = $('planPanel');
      if (!open) clearNearbyPins();
      measurePlanBar();
      const closing = !open && panel.classList.contains('open');
      const opening = open && !panel.classList.contains('open');
      panel.classList.toggle('open', open);
      $('app').classList.toggle('plan-open', open);
      // U-122: the chosen route stays on screen; not when the card went down for a sheet or a drive (the camera keeps still
      // under a sheet, F-02), which is settled by the next frame
      if (opening && panel.classList.contains('routed') && !booting) requestAnimationFrame(() => { if (panel.classList.contains('open') && state.mode !== 'live') fitPlannedRoute(plannedRoute, true); });   // DA-2
      if (closing && panel.classList.contains('routed')) requestAnimationFrame(() => { let driving = false; try { driving = driveActive; } catch (_) {} if (!panel.classList.contains('open') && !$('app').classList.contains('sheet-open') && !driving) fitPlannedRoute(); });
      $('destInput').setAttribute('aria-expanded', String(open));
      if (opening) { panel.classList.remove('full'); $('planBody').scrollTop = 0; }   // finding 2: a re-plan keeps the scroll
      if (open) { refreshSavedDrives(); if (!panel.classList.contains('routed')) renderPlaces(); closeEdge(); peekTimeAttack(); }
      else { $('destInput').blur(); $('fromInput').blur(); }                 // closing puts the keyboard away
    }
    // Routing progress shows under From (the old Go button carried it).
    function planBusy() {
      const panel = $('planPanel'); panel.classList.add('busy');
      cardNote('');
      return { step(text) { $('planStatus').textContent = text; cardProgress(text); },
        done() { panel.classList.remove('busy'); $('planStatus').textContent = ''; cardProgress(''); } };
    }
    // finding 1: one line on the card for the plan: its progress while it works (a spinner), then what it found, which stays
    // until the next plan, a pick or the route going
    let cardNoteText = '';
    function cardProgress(text) {
      const p = $('routeProgress');
      if (text) { p.textContent = text; p.className = 'rc-progress busy'; return; }
      p.textContent = cardNoteText; p.className = cardNoteText ? 'rc-progress found' : 'rc-progress';
    }
    function cardNote(text) {
      cardNoteText = text || '';
      if (!$('planPanel').classList.contains('busy') || !text) cardProgress('');
      if (text) announce(text);
    }
    // ✕ on the route bar: back to Where to? and the idle map.
    function clearPlanned() {
      plannedRoute = null;
      routeOptions = null;
      leaveAtMs = null; whenReset();
      cardNote('');
      showExplore(null);
      markDestination(null);
      try { sessionStorage.removeItem(PLANNED); localStorage.removeItem(PLANNED); } catch (_) {}
      paintEtaShareBtn();
      $('destInput').value = '';
      $('planPanel').classList.remove('full');
      renderRouteCard(null);
      paintTask();
      if (track && track.kind === 'route' && state.mode !== 'live') {
        setPlaying(false); replayOn = false; track = null;
        if (mapReady) { map.getSource('apex-route-src').setData(emptyFC()); map.getSource('apex-ribbon-src').setData(emptyFC()); ribbonKey = ''; }
        penStop(); revealLast = null;                                 // the next route found is a new find, drawn on in full
        rebuildPins(); paintIdle(); render(true);
      }
      resumeFollow();
    }
    $('planClear').addEventListener('click', clearPlanned);
    $('routeBar').addEventListener('click', () => openPlan(!$('planPanel').classList.contains('open')));
    $('destInput').addEventListener('focus', () => { if (!$('planPanel').classList.contains('open')) openPlan(true); policeWarm(); });
    $('planCancel').addEventListener('click', () => openPlan(false));
    // TestFlight 2026-11-05 ("takes up so much screen"): on the idle map the deck under Where to? (Best roads nearby, the
    // suggestion, your road) folds away with a swipe down on the bar, like a sheet's lowest detent, and comes back with a swipe
    // up; the next swipe up opens Where to? as before. Kept on this phone. Nothing is lost folded: all of it is in Where to?.
    let deckMin = false;
    try { deckMin = localStorage.getItem('apex.deckMin') === '1'; } catch (_) {}
    function setDeckMin(on, say = true) {
      deckMin = !!on; $('app').classList.toggle('deck-min', deckMin);
      try { if (deckMin) localStorage.setItem('apex.deckMin', '1'); else localStorage.removeItem('apex.deckMin'); } catch (_) {}
      if (say) announce(deckMin ? 'Suggestions folded away. Swipe up on Where to? to bring them back.' : 'Suggestions shown.');
    }
    setDeckMin(deckMin, false);
    {
      const panel = $('planPanel');
      let y0 = null, base = 0, moved = false, t0 = 0;
      const collapsedY = () => panel.offsetHeight - $('planBar').offsetHeight - 2;
      // finding 10: the route card opens at half height; dragged up by its bar it takes the full sheet, down it goes to half,
      // then to the bar. Its height follows the finger (the Start foot stays at the bottom, where the thumb is).
      let h0 = 0, card = false;
      $('planBar').addEventListener('pointerdown', (e) => { y0 = e.clientY; t0 = performance.now(); moved = false; base = panel.classList.contains('open') ? 0 : collapsedY();
        card = panel.classList.contains('open') && panel.classList.contains('routed'); h0 = panel.offsetHeight; });
      window.addEventListener('pointermove', (e) => {
        if (y0 == null) return;
        const dy = e.clientY - y0;
        if (!moved && Math.abs(dy) < 8) return;                         // a tap, not a drag
        moved = true; panel.classList.add('dragging');
        if (card) { panel.style.height = `${Math.max($('planBar').offsetHeight + 2, h0 - dy)}px`; return; }
        panel.style.transform = `translateY(${Math.max(0, Math.min(collapsedY(), base + dy))}px)`;
      });
      const release = (e) => {
        if (y0 == null) return;
        const dy = e.clientY - y0, fast = Math.abs(dy) / Math.max(1, performance.now() - t0) > 0.5; y0 = null;
        panel.classList.remove('dragging'); panel.style.transform = ''; panel.style.height = '';
        if (!moved) return;
        const open = panel.classList.contains('open');
        if (card) {
          const full = panel.classList.contains('full');
          if (dy < -60 || (fast && dy < -20)) { panel.classList.add('full'); return; }                    // up: the whole card
          if (full && (dy > 60 || (fast && dy > 20)) && h0 - dy > 0.35 * h0) { panel.classList.remove('full'); return; }   // down a step: half
          if (dy > 80 || (fast && dy > 20)) openPlan(false);                                               // down: the bar
          return;
        }
        if (!open && $('app').classList.contains('idle') && !panel.classList.contains('routed')) {
          if (dy > 40 || (fast && dy > 15)) { if (!deckMin) setDeckMin(true); return; }                      // down: fold the deck
          if (deckMin && (dy < -40 || (fast && dy < -15))) { setDeckMin(false); return; }                    // up, folded: unfold it first
        }
        openPlan(open ? !(dy > 80 || (fast && dy > 20)) : (dy < -80 || (fast && dy < -20)));
      };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    }
    // While-you-drive switches: the tab and its panel slide in together; tapping the map closes them.
    function closeEdge() { $('swEdge').classList.remove('open'); $('swTab').setAttribute('aria-expanded', 'false'); }
    $('swTab').addEventListener('click', () => {
      const open = !$('swEdge').classList.contains('open');
      $('swEdge').classList.toggle('open', open);
      $('swTab').setAttribute('aria-expanded', String(open));
      // the panel ends above the deck, whatever the deck holds (the loop row, the tab bar on a small phone), and scrolls (REVIEW2.md 1.9)
      const panel = $('swPanel'); panel.style.maxHeight = '';
      if (open) requestAnimationFrame(() => {
        const deck = document.querySelector('.plan'), top = panel.getBoundingClientRect().top, floor = deck && !deck.classList.contains('open') ? deck.getBoundingClientRect().top : innerHeight;
        if (floor - top - 12 < panel.offsetHeight) panel.style.maxHeight = `${Math.max(120, floor - top - 12)}px`;
      });
    });
    map.on('click', closeEdge);
    // Places to go without typing: recent destinations, then saved spots.
    const RECENT_PLACES = 'apex.recentPlaces';
    function recentPlaces() { try { return JSON.parse(localStorage.getItem(RECENT_PLACES) || '[]'); } catch (_) { return []; } }
    function rememberPlace(p) {
      if (!p || !p.label || p.label === PIN_WORD || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
      try { localStorage.setItem(RECENT_PLACES, JSON.stringify([{ label: p.label, lat: p.lat, lon: p.lon }, ...recentPlaces().filter(q => q.label !== p.label)].slice(0, 6))); } catch (_) {}
      carPost(carPlaces());   // the car's Places list
    }
    // Typing in Where to? suggests places near you. Photon is OpenStreetMap search built for search-as-you-type (public
    // Nominatim forbids it, and stays for the final geocode). Offline: no list; typing and Go still work.
    // Near first: Photon's lat/lon is only a soft bias (it happily returns Malaysia), so ask inside a box about 150 km
    // around you (the phone's position, else the map's centre); only when nothing is there, ask everywhere. Nearest first.
    // No signal (IDEAS F-02): towns within about 25 km and places within about 4 km, from the map tiles kept on the phone
    // (a saved area or route, or tiles the map showed lately; stages.js reads them offline). A tile that isn't kept is
    // simply not searched; nothing leaves the phone.
    const KEPT_KIND = { city: 'City', town: 'Town', village: 'Village' };
    async function mapSuggest(q) {
      if (!window.ApexStages || !ApexStages.places || !ApexStages.poisAll) return [];
      const c0 = map.getCenter(), near = state.lastPosition || { lat: c0.lat, lon: c0.lng };
      const grid = (radiusKm, stepKm) => {
        const out = [], dLat = stepKm / 110.54, dLon = stepKm / (111.32 * Math.cos(near.lat * Math.PI / 180)), n = Math.round(radiusKm / stepKm);
        for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (Math.hypot(i, j) * stepKm <= radiusKm + stepKm / 2) out.push({ lat: near.lat + i * dLat, lon: near.lon + j * dLon });
        return out;
      };
      const settled = async (pts, f) => (await Promise.allSettled(pts.map((p) => f([p])))).flatMap((r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []));
      // a weak signal (a tile not kept, asked of the network) gets 6 s; kept tiles answer at once
      const got = await Promise.race([Promise.all([settled(grid(24, 8), ApexStages.places), settled(grid(4, 1.5), ApexStages.poisAll)]), new Promise((r) => setTimeout(() => r(null), 6000))]);
      if (!got) return [];
      const [towns, spots] = got;
      const word = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');
      return ApexPlaceSearch.mapMatches(q, [...towns.map((t) => ({ name: t.name, lat: t.lat, lon: t.lon, kind: KEPT_KIND[t.cls] || 'Place' })),
        ...spots.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, kind: word(p.sub || p.cls) || 'Place' }))], near, 5);
    }
    async function photonSuggest(q) {
      const c0 = map.getCenter(), near = state.lastPosition || { lat: c0.lat, lon: c0.lng };
      const ask = async (extra) => (await RouteLoading.json(`https://photon.komoot.io/api/?limit=10&lang=en&q=${encodeURIComponent(q)}`
        + `&lat=${near.lat.toFixed(3)}&lon=${near.lon.toFixed(3)}${extra}`, {}, 6000)).features || [];
      const dLat = 1.4, dLon = 1.4 / Math.max(0.2, Math.cos(near.lat * Math.PI / 180));
      let feats = await ask(`&bbox=${(near.lon - dLon).toFixed(3)},${(near.lat - dLat).toFixed(3)},${(near.lon + dLon).toFixed(3)},${(near.lat + dLat).toFixed(3)}`);
      if (!feats.length) feats = await ask('');
      const km = (lat, lon) => Math.hypot((lat - near.lat) * 111.2, (lon - near.lon) * 111.32 * Math.cos(near.lat * Math.PI / 180));
      return feats.filter(ApexPlaceSearch.drivable).map(f => {             // no bike paths or footways (U-19)
        const p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
        const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || q;
        const area = [p.city || p.town || p.village || p.county, p.state].filter(x => x && x !== name).join(', ');
        return { label: name, lat: c[1], lon: c[0], area, km: km(c[1], c[0]) };
      }).filter((p, i, all) => Number.isFinite(p.lat) && Number.isFinite(p.lon)
        && all.findIndex(o => o.label === p.label && o.area === p.area) === i)   // one row per place (OSM can hold a node and an area)
        .sort((a, b) => a.km - b.km).slice(0, 5)
        .map(p => ({ ...p, sub: p.area, kind: ApexUnits.long(p.km * 1000, 1, true) }));   // U-73: the town under the name, the distance as the stamp
    }
    // In the app, Apple's place search (the shell's MKLocalSearchCompleter: knows house numbers, no key) answers instead;
    // coordinates are asked only for the row tapped. No answer in 4 s: Photon.
    const nativePlace = { waiting: new Map(), next: 1 };
    function askNative(msg, timeoutMs) {
      return new Promise((resolve) => {
        const id = nativePlace.next++;
        const timer = setTimeout(() => { nativePlace.waiting.delete(id); resolve(null); }, timeoutMs);
        nativePlace.waiting.set(id, (reply) => { clearTimeout(timer); nativePlace.waiting.delete(id); resolve(reply); });
        try { window.webkit.messageHandlers.apex.postMessage({ ...msg, id }); } catch (_) { clearTimeout(timer); nativePlace.waiting.delete(id); resolve(null); }
      });
    }
    function nativePlaceReply(msg) { const done = nativePlace.waiting.get(msg.id); if (done) done(msg); }
    async function appleSuggest(q) {
      const c0 = map.getCenter(), near = state.lastPosition || { lat: c0.lat, lon: c0.lng };
      const reply = await askNative({ cmd: 'placeComplete', q, lat: near.lat, lon: near.lon }, 4000);
      if (!reply || reply.failed || !Array.isArray(reply.items)) return null;
      // U-73: the name wins the row; the address goes under it as street and town (no region, postcode or country)
      return reply.items.map((it, index) => ({ label: it.title, sub: ApexPlaceSearch.shortAddress(it.subtitle), kind: '', apple: { id: reply.id, index } }));
    }
    async function appleResolve(p) {
      const reply = await askNative({ cmd: 'placeResolve', index: p.apple.index }, 8000);
      return reply && Number.isFinite(reply.lat) && Number.isFinite(reply.lon) ? { lat: reply.lat, lon: reply.lon } : null;
    }
    let suggestTimer = null, suggestSeq = 0, shownRows = { q: '', rows: [] }, allPlaces = false;
    $('destInput').addEventListener('input', () => { clearTimeout(suggestTimer); suggestTimer = setTimeout(renderPlaces, 300); paintTask(); });
    // finding 3: with something typed, the loop gives way and the main key goes to the place (as Enter does); with
    // nothing typed it finds a loop
    function paintTask() {
      const q = $('destInput').value.trim(), typing = !!q && !$('planPanel').classList.contains('routed');
      $('planPanel').classList.toggle('typing', typing);
      $('findGoBtn').hidden = !typing;
      const top = typing && shownRows.q === q && shownRows.rows[0];
      $('findGoBtn').textContent = top ? `Go to ${top.label}` : 'Search';
    }
    $('findGoBtn').addEventListener('click', () => {
      const q = $('destInput').value.trim();
      if (!q) return;
      if (window.ApexRouteImport && ApexRouteImport.parseMapsLink(q)) routeToQuery(); else goTyped();
    });
    // Go (or Enter) on what's typed in Where to?: the list's top row when it's up; else your place by that name, or the map
    // search's top row when it lands (placesFor), before a full geocode (routeToQuery). A start typed too: routeToQuery.
    function goTyped() {
      const q = $('destInput').value.trim(), top = shownRows.q === q && shownRows.rows[0];
      const take = (p) => (p.saved ? openSaved(p.saved) : routeToPlace(p));
      if (top) return take(top);
      if ($('fromInput').value.trim() || $('planPanel').classList.contains('busy')) return routeToQuery();
      clearTimeout(suggestTimer);
      if (placesAsk.q === q) toast('Searching…');
      const near = window.ApexNearby && ApexNearby.categoryOf(q, isElectric());   // "gas" with none found: the list says so
      return placesFor(q).then((p) => { if ($('destInput').value.trim() !== q) return null; if (p) return take(p); return near ? null : routeToQuery(); }).catch(() => (near ? null : routeToQuery()));
    }
    // Siri (ApexIntents.swift DriveToIntent): "Drive somewhere with Vetta", then the place said aloud. Where to? as if it
    // were typed and Go pressed: your own places by that name first, then the map's search. Never over a drive.
    function goSpoken(words) {
      const q = String(words || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!q) return null;
      if (driveActive) { toast('End the drive to plan a new route.'); return null; }
      closeSheet(); openPlan(true);
      $('destInput').value = q; $('fromInput').value = ''; paintTask();
      clearTimeout(suggestTimer); renderPlaces();                       // the search for these words starts now (placesAsk)
      return goTyped();
    }
    // Your places by name while typing (pinned first, then recent; tests/test_place_search.py): on the phone, so the list's
    // top row, and Enter, need no network for a place you've been (2026-11-08)
    const yourPlaces = () => [...ApexPinnedPlaces.list(localStorage).map((p) => ({ label: p.name, lat: p.lat, lon: p.lon, kind: p.label && p.label !== p.name ? p.label : 'Pinned' })),
      ...recentPlaces().map((p) => ({ ...p, kind: 'Recent' }))];
    function mineFor(q) {
      let segs = [];
      try { segs = JSON.parse(localStorage.getItem('apex.segments') || '[]'); } catch (_) {}
      return ApexPlaceSearch.localMatches(q, segs, loadHighlights(), 4, yourPlaces());
    }
    // Find nearby (nearby.js, against Apple Maps' and Google Maps' Gas / Coffee / Food): the keys put their word in Where
    // to?, and "gas", "coffee near me" or "food" typed lists the nearest by name from the map's own tiles (stages.js
    // poisAll, kept on the phone: works with no signal where the map was seen), the same places the car's Places name.
    const isElectric = () => { const c = routingCar(); return !!(c && c.fuel === 'electric'); };
    // the keys' glyphs (24 px grid, BRAND.md Icons): a pump, a bolt, a cup, a fork and knife
    const NEARBY_GLYPH = { gas: 'M5 21V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V21M3.5 21h12M7.5 9h4M14 10h1.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 0 3 0V8.5L17.5 6',
      charge: 'M13 3 6 13.5h5L10 21l7-10.5h-5z', coffee: 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 11h1.5a2.5 2.5 0 0 1 0 5H16M9 3.5v2.5M12.5 3.5v2.5',
      food: 'M7 3v7M5 3v5a2 2 0 0 0 4 0V3M7 10v11M17 21V3c-2 1.5-3 4.5-3 9h3' };
    function paintNearbyKeys() {
      const box = $('nearbyKeys');
      if (!window.ApexNearby) { box.hidden = true; return; }
      const want = ApexNearby.keys(isElectric()).join();
      if (box.dataset.keys !== want) {
        box.dataset.keys = want;
        box.replaceChildren(...ApexNearby.keys(isElectric()).map((k) => {
          const b = document.createElement('button'), c = ApexNearby.CATS[k];
          b.className = 'chip rkey'; b.setAttribute('aria-label', `${c.label} nearby`);
          const i = document.createElement('i'); i.setAttribute('aria-hidden', 'true'); i.innerHTML = `<svg viewBox="0 0 24 24"><path d="${NEARBY_GLYPH[k]}"/></svg>`;
          b.append(i, c.label);
          b.addEventListener('click', () => { $('destInput').value = c.label; clearTimeout(suggestTimer); renderPlaces(); paintTask(); });
          return b;
        }));
      }
      box.hidden = !!$('destInput').value.trim();
    }
    // where "nearby" is: your position when it's fresh, else the middle of the map
    function nearbyHere() {
      const p = state.lastPosition;
      if (p && state.lastPositionAt && performance.now() - state.lastPositionAt < 120000) return { lat: p.lat, lon: p.lon };
      const c = map.getCenter(); return { lat: c.lat, lon: c.lng };
    }
    async function nearbyFor(cat) {
      const here = nearbyHere();
      let rows = [], failed = false;
      for (const km of [3, 8]) {                                         // 3 km is ~25 tiles; 8 km only when that finds few
        let pois;
        try { pois = await ApexStages.poisAll(ApexNearby.gridPoints(here.lat, here.lon, km)); } catch (_) { failed = !rows.length; break; }
        rows = ApexNearby.list(pois, here, cat, { km });
        if (rows.length >= 3) break;
      }
      return { rows, failed };
    }
    async function renderNearby(q, cat, seq) {
      paintPlaces(q, [], 'Looking nearby…', 0);
      const here = nearbyHere(), { rows, failed } = await nearbyFor(cat);
      if (seq !== suggestSeq) return;                                    // a newer keystroke won
      const out = rows.map((r) => ({ label: r.label, lat: r.lat, lon: r.lon, kind: ApexUnits.long(r.m) }));
      paintPlaces(q, out, out.length ? '' : ApexNearby.emptyLine(cat, failed, 8, (m) => ApexUnits.long(m)), 0);
      paintNearbyPins(rows, cat, here, out);
      warmPlace(out[0]);
      // then whether each is open, under its name (place_info.js, one request for the list); unknown says nothing
      if (window.ApexPlaceInfo && out.length) ApexPlaceInfo.lookupMany(rows.map((r) => (r.named ? { name: r.label, lat: r.lat, lon: r.lon } : null))).then((tags) => {
        if (seq !== suggestSeq || !tags) return;
        const now = new Date();
        let any = false;
        tags.forEach((t, i) => { const h = t ? ApexPlaceInfo.contact(t, now).hours : null; if (h) { out[i].sub = h.text; any = true; } });
        if (any) paintPlaces(q, out, '', 0);
      }).catch(() => {});
    }
    // the listed places on the map too, by name (an unnamed one by its stamp), the map fitted to them above the sheet; a tap
    // on one goes there, as its row does. They go when the list stops being a kind, the plan closes, or a route is planned.
    let nearbyPins = [];
    function clearNearbyPins() { for (const m of nearbyPins) m.remove(); nearbyPins = []; $('planPanel').classList.remove('nearby'); }
    // one name never over another: a farther place's pin waits while a nearer one's covers it (the list keeps them all)
    function declutterNearby() {
      const kept = [];
      for (const m of nearbyPins) {
        const el = m.getElement(); el.style.visibility = '';
        const r = el.getBoundingClientRect();
        if (kept.some((k) => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 2 && r.bottom > k.top - 2)) el.style.visibility = 'hidden';
        else kept.push(r);
      }
    }
    map.on('moveend', () => { if (nearbyPins.length) declutterNearby(); });
    function paintNearbyPins(rows, cat, here, out) {
      clearNearbyPins();
      if (!rows.length || !mapReady) return;
      // the sheet comes down to half (a phone, not typing), so the places show on the map above their list, as Apple's does
      if (!document.documentElement.classList.contains('kb-open')) $('planPanel').classList.add('nearby');
      rows.forEach((r, i) => {
        const el = document.createElement('div'); el.className = `poi-pin nearby-pin poi-${cat === 'charge' ? 'charge' : cat}`;
        el.textContent = r.named ? r.label : ApexNearby.CATS[cat].stamp;
        el.setAttribute('role', 'button'); el.setAttribute('aria-label', `${r.label}, ${out[i].kind}`);
        el.addEventListener('click', (e) => { e.stopPropagation(); suppressMapClickUntil = Date.now() + 400; routeToPlace(out[i]); });
        nearbyPins.push(new maplibregl.Marker({ element: el }).setLngLat([r.lon, r.lat]).addTo(map));
      });
      declutterNearby();
      const top = $('planPanel').getBoundingClientRect().top, h = map.getContainer().clientHeight;
      if (top < h * 0.3) return;                                         // the sheet is up over most of the map: leave the view
      let w = here.lon, e = here.lon, so = here.lat, n = here.lat;
      for (const r of rows) { w = Math.min(w, r.lon); e = Math.max(e, r.lon); so = Math.min(so, r.lat); n = Math.max(n, r.lat); }
      fitInView([[w, so], [e, n]], Math.max(0, h - top) + 24, 600);
    }
    // the map search asked for what's typed (Enter pressed before its rows are up waits for them: placesFor)
    let placesAsk = { q: null, p: null };
    async function renderPlaces() {
      const q = $('destInput').value.trim(), seq = ++suggestSeq;
      let rows, empty = '';
      paintNearbyKeys();
      const cat = window.ApexNearby && window.ApexStages && !COORDS.test(q) && !pinIn('destInput', q) ? ApexNearby.categoryOf(q, isElectric()) : null;
      if (!cat) clearNearbyPins();
      if (cat) {
        let done;
        placesAsk = { q, p: new Promise((r) => { done = r; }) };
        try { await renderNearby(q, cat, seq); } finally { done(); }
        return;
      }
      if (q.length >= 3 && !COORDS.test(q) && !pinIn('destInput', q)) {
        // your own places, stages and spots by name first (U-19), at once; then the map search's rows below them
        const mine = mineFor(q);
        if (mine.length) paintPlaces(q, mine, '', 0);
        let done;
        placesAsk = { q, p: new Promise((r) => { done = r; }) };
        try {
          try { rows = (IN_APP_SHELL && await appleSuggest(q)) || await photonSuggest(q); } catch (_) {
            // no signal, or one bar that carries nothing: the map kept on the phone has the towns and places round you (mapSuggest)
            rows = await mapSuggest(q).catch(() => []);
            if (!mine.length && !rows.length) empty = navigator.onLine === false ? 'No signal, and no match on the map kept on this phone.' : 'Suggestions didn\'t load. Press Search to try.';
          }
          if (seq !== suggestSeq) return;                                // a newer keystroke won
          rows = [...mine, ...rows.filter((r) => !mine.some((m) => ApexPlaceSearch.norm(m.label) === ApexPlaceSearch.norm(r.label)))];
          if (!rows.length && !empty) empty = 'No matches nearby. Press Search to look everywhere.';
          paintPlaces(q, rows, empty, 0);
          warmPlace(rows[0]);
        } finally { done(); }
        return;
      }
      rows = [...ApexPinnedPlaces.list(localStorage).map(p => ({ label: p.name, lat: p.lat, lon: p.lon, kind: p.label, pinned: p })),
              ...ApexSavedRoutes.list(localStorage).slice(0, 4).map(p => ({ label: p.name, kind: Number.isFinite(p.miles) ? `Saved · ${ApexUnits.long(p.miles * 1609.344)}` : 'Saved', saved: p })),
              ...recentPlaces().map(p => ({ ...p, kind: 'Recent' })),
              ...loadHighlights().filter(h => Number.isFinite(h.lat) && Number.isFinite(h.lon)).map(h => ({ label: h.name || 'Spot', lat: h.lat, lon: h.lon, kind: 'Spot' }))].slice(0, 10 + ApexPinnedPlaces.MAX);
      // with nothing typed, three places and a row for the rest (REVIEW.md: search and three recents, the default first)
      // The rest are drawn too but stay folded until the keyboard is up (TestFlight 2026-11-12 "evil cluttered gap"): while
      // typing the list is the sheet, so it fills the space above the keyboard instead of a link and an empty band.
      const more = !q && !allPlaces && rows.length > 3 ? rows.length - 3 : 0;
      paintPlaces(q, rows, empty, more);
    }
    function paintPlaces(q, rows, empty, more) {
      const box = $('placeList');
      shownRows = { q, rows: empty ? [] : rows };
      paintTask();
      if (empty) { const n = document.createElement('p'); n.className = 'note'; n.textContent = empty; box.replaceChildren(n); box.hidden = false; return; }
      box.replaceChildren(...rows.map((p, i) => {
        const b = document.createElement('button'); b.className = 'place';
        if (more && i >= rows.length - more) b.classList.add('place-extra');
        const name = document.createElement('b'); name.textContent = p.label;
        // the kind is said once for a run of the same (three Recents read "Recent", then two blanks; 2026-11-13 sweep), and
        // read aloud on every row
        const kind = document.createElement('span'); kind.textContent = !q && i > 0 && p.kind && rows[i - 1].kind === p.kind ? '' : p.kind || '';
        if (p.kind && !kind.textContent) b.setAttribute('aria-label', `${p.label}, ${p.kind}`);
        b.append(name, kind);
        if (p.sub && p.sub !== p.label) { const sub = document.createElement('small'); sub.textContent = p.sub; b.append(sub); }   // U-73
        b.addEventListener('click', () => (p.saved ? openSaved(p.saved) : routeToPlace(p)));
        if (!p.pinned) return b;
        // a pinned place (U-20): its own row with Unpin beside it
        const un = document.createElement('button'); un.className = 'linkbtn'; un.textContent = 'Unpin'; un.setAttribute('aria-label', `Unpin ${p.label}`);
        un.addEventListener('click', (e) => { e.stopPropagation(); ApexPinnedPlaces.unpin(localStorage, p.pinned.name); renderPlaces(); carPost(carPlaces()); itemsChanged(); });
        const row = document.createElement('div'); row.className = 'row pinned-row'; row.append(b, un);
        if (b.classList.contains('place-extra')) { b.classList.remove('place-extra'); row.classList.add('place-extra'); }
        return row;
      }));
      if (more) {
        const all = document.createElement('button'); all.className = 'linkbtn place-all'; all.textContent = `All places (${more} more)`;
        all.addEventListener('click', () => { allPlaces = true; renderPlaces(); });
        box.append(all);
      }
      box.hidden = !rows.length;
    }
    // The top suggestion's graph tile read into the routing worker while you choose (the region's fetched and kept): the
    // plan to it starts with its tiles in hand. Once per tile.
    const warmedPlaces = new Set();
    function warmPlace(p) {
      try {
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !ownOn() || !window.ApexGraphTiles) return;
        const t = ApexGraphTiles.tileOf(p.lat, p.lon), k = `${t.i}_${t.j}`;
        if (warmedPlaces.has(k)) return;
        warmedPlaces.add(k);
        ownRouter().covers([p]).then((ok) => (ok ? ownRouter().preload({ lat: p.lat, lon: p.lon, km: 0 }) : null)).catch(() => warmedPlaces.delete(k));
      } catch (_) { /* the plan loads it */ }
    }
    // Enter before the list is up (2026-11-08): your own place by that name at once; else the map search already asked
    // for what's typed, given PLACES_WAIT_MS (it is the list's top row Enter takes once it's up); else the full geocode
    const PLACES_WAIT_MS = 1500;
    async function placesFor(q) {
      if (q.length < 3 || COORDS.test(q) || pinIn('destInput', q)) return null;
      const mine = mineFor(q);
      if (mine.length) return mine[0];
      // "gas": the nearest one once the tiles are read (the tiles can take a few seconds on a slow signal; a geocode of the
      // word would be a town called Gas)
      const near = window.ApexNearby && ApexNearby.categoryOf(q, isElectric());
      if (near && placesAsk.q !== q) renderPlaces();
      if (placesAsk.q === q && placesAsk.p) await RouteLoading.optional(placesAsk.p, near ? 15000 : PLACES_WAIT_MS);
      return shownRows.q === q ? shownRows.rows[0] || null : null;
    }
    async function routeToPlace(p) {
      if ($('planPanel').classList.contains('busy')) return;
      clearNearbyPins();
      $('destInput').value = p.label;
      const ui = planBusy();
      ui.step('Routing…', 0.5);
      try {
        if (!Number.isFinite(p.lat) && p.apple) {                       // an Apple suggestion: its coordinates now
          const at = await appleResolve(p);
          if (!at) throw new Error('Couldn\'t find that place. Try another.');
          p = { ...p, ...at };
        }
        const from = await resolvePlace($('fromInput').value, 'fromInput');
        const request = { from: from.label === null ? null : { lat: from.lat, lon: from.lon }, to: { lat: p.lat, lon: p.lon }, via: [] };
        await funRoute(from, { lat: p.lat, lon: p.lon }, 'route_dest', toName(p.label), request, ui);
        rememberPlace(p);
      } catch (err) { toast(errText(err)); } finally { ui.done(); }
    }

    const closeSheet = () => showView(null);
    document.querySelectorAll('#tabbar .tab').forEach(t => t.addEventListener('click', () => showView(view === t.dataset.view ? null : t.dataset.view)));
    document.querySelectorAll('[data-people]').forEach((b) => b.addEventListener('click', () => setPeopleSide(b.dataset.people)));
    // the tabs' keys (ARIA tabs): left and right move between Friends and Crews, focus with them
    document.querySelector('.people-tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); setPeopleSide(peopleSide === 'friends' ? 'crews' : 'friends');
      document.querySelector(`[data-people="${peopleSide}"]`).focus();
    });
    $('scrim').addEventListener('click', closeSheet);
    $('pinCancelBtn').addEventListener('click', closePin);
    onBackdrop($('pinOverlay'), () => closePin());
    $('pinGoBtn').addEventListener('click', () => {
      if (!droppedPin) return;
      $('fromInput').value = '';
      setFieldPin('destInput', droppedPin, $('pinPlace').textContent);   // by the name the sheet showed
      closePin();
      routeToQuery();
    });
    $('pinFromBtn').addEventListener('click', () => {
      if (!droppedPin) return;
      setFieldPin('fromInput', droppedPin, $('pinPlace').textContent);
      state.planField = 'fromInput';
      closePin(); openPlan(true);
    });
    // A stop added to the planned route at `pin`, ordered by `atM` along it (default: where the pin falls on it), no backtracking.
    async function addViaAt(pin, atM = null) {
      const current = plannedRoute, req = current && current.request;
      if (!req) return false;
      const from = req.from || await locate();
      if (!from) { toast(NO_FIX); return false; }
      const pinM = atM ?? current.dist[Core.nearestIndex(pin.lat, pin.lon, current.lat, current.lon, -1).index];
      const via = FunRoute.insertVia(req.via.map(v => ({ lat: v.lat, lon: v.lon, distM: v.distM, ...(v.shaping ? { shaping: true } : {}), ...(v.planned ? { planned: true } : {}), ...(v.label ? { label: v.label } : {}) })),
        { lat: pin.lat, lon: pin.lon, ...(pin.label ? { label: pin.label } : {}) }, pinM)
        .map(({ distM, ...v }) => v);
      await buildRoute([from, ...via, req.to], current.id, current.name, null, { from: req.from, to: req.to, via });
      return true;
    }
    // Your stops on the route card (trip_stops.js, IDEAS R-17): move up or down, take out; the route is rebuilt through them.
    function paintStops(t) {
      const box = $('routeStops');
      const list = t && t.request ? ApexTripStops.stops(t.request) : [];
      box.hidden = !list.length;
      if (!list.length) { box.replaceChildren(); return; }
      const reroute = async (via) => {
        const req = t.request, from = req.from || await locate();
        if (!from) { toast(NO_FIX); return; }
        await buildRoute([from, ...via, req.to], t.id, t.name, null, { from: req.from, to: req.to, via });
      };
      const b = (label, aria, fn) => { const n = document.createElement('button'); n.className = 'linkbtn'; n.textContent = label; n.setAttribute('aria-label', aria); n.addEventListener('click', fn); return n; };
      box.replaceChildren(...list.map((s, k) => {
        const row = document.createElement('div'); row.className = 'row stop-row';
        const name = document.createElement('span'); name.textContent = `${k + 1}. ${s.label}`;
        row.append(name,
          ...(k > 0 ? [b('Up', `Move ${s.label} earlier`, () => reroute(ApexTripStops.move(t.request, k, -1)))] : []),
          ...(k < list.length - 1 ? [b('Down', `Move ${s.label} later`, () => reroute(ApexTripStops.move(t.request, k, 1)))] : []),
          b('Remove', `Remove ${s.label}`, () => reroute(ApexTripStops.remove(t.request, k))));
        return row;
      }));
    }
    $('pinViaBtn').addEventListener('click', async (e) => {
      if (!droppedPin || !plannedRoute?.request) return;
      const pin = droppedPin, b = e.currentTarget;
      b.disabled = true;
      closePin();
      await addViaAt(pin);
      b.disabled = false;
    });
    $('pinSaveBtn').addEventListener('click', () => {
      if (!droppedPin) return;
      const point = droppedPin;
      closePin(); openHighlightDialog(point);
    });
    (() => {   // swipe the panel right to close
      const sheet = $('sheet');
      let x0 = null, y0 = 0, dx = 0;
      // not from the looks' shelf: a sideways drag there turns to the next look
      sheet.addEventListener('touchstart', (e) => { x0 = e.target.closest && e.target.closest('.theme-cards') ? null : e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; }, { passive: true });
      sheet.addEventListener('touchmove', (e) => {
        if (x0 == null) return;
        dx = e.touches[0].clientX - x0;
        if (Math.abs(e.touches[0].clientY - y0) > Math.abs(dx) && !sheet.classList.contains('dragging')) { x0 = null; return; }
        if (dx > 8) { sheet.classList.add('dragging'); sheet.style.transform = `translateX(${dx}px)`; }
      }, { passive: true });
      sheet.addEventListener('touchend', () => {
        sheet.classList.remove('dragging'); sheet.style.transform = '';
        if (x0 != null && dx > 80) closeSheet();
        x0 = null;
      });
    })();
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('hlOverlay').classList.contains('show')) closeHighlightDialog();
      else if (explainOpen()) closeExplain();
      else if ($('pinOverlay').classList.contains('show')) closePin();
      else if ($('optSheet').classList.contains('open')) closeOptions();
      else if ($('nearbySheet').classList.contains('open')) closeNearby();
      else if (view) closeSheet();
    });
    ['fromInput', 'destInput'].forEach(id => {
      $(id).addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (window.apexDebug) window.apexDebug.enterAt = performance.now();
        e.preventDefault(); e.target.blur();
        if (id === 'destInput' && !e.target.value.trim()) return;      // nothing typed: Go only puts the keyboard away (Find a loop is back)
        if (id === 'fromInput' && $('optSheet').classList.contains('open')) { closeOptions(); if (!plannedRoute && $('destInput').value.trim()) routeToQuery(); return; }
        const pasted = id === 'destInput' && window.ApexRouteImport && ApexRouteImport.parseMapsLink($('destInput').value);   // a maps link beats the top suggestion
        if (pasted || id !== 'destInput') routeToQuery(); else goTyped();
      });
      $(id).addEventListener('focus', () => { state.planField = id; });
    });
    $('swapBtn').addEventListener('click', () => { const f = $('fromInput'), t = $('destInput'); [f.value, t.value] = [t.value, f.value]; [fieldPin.fromInput, fieldPin.destInput] = [fieldPin.destInput, fieldPin.fromInput]; });
    $('tapRouteBtn').addEventListener('click', (e) => {
      state.tapToRoute = !state.tapToRoute;
      e.currentTarget.classList.toggle('on', state.tapToRoute);
      if (state.tapToRoute) { closeSheet(); openPlan(false); toast(state.planField === 'fromInput' ? 'Tap the map where you want to start.' : 'Tap the map where you want to go.'); }
    });
    // Loop lengths in the chosen units (U-22), one unit on the whole dial (finding 6): 15-90 mi or 25-150 km, kept as miles inside.
    // By time (2026-11-10: a loop is aimless driving, and "I have an hour" is how it is asked for; 1 hour and 2 hours sat
    // in Options): the same dial, its five detents half an hour to three hours. LOOP_BY keeps which the dial is set to.
    const LOOP_BY = 'apex.loopBy', LOOP_MINUTES = [30, 60, 90, 120, 180];
    let loopBy = 'distance';
    try { if (localStorage.getItem(LOOP_BY) === 'time') loopBy = 'time'; } catch (_) { /* storage off */ }
    function labelLoops() {
      document.querySelectorAll('#loopDetents button').forEach((b, i) => {
        if (loopBy === 'time') { delete b.dataset.loopMi; b.dataset.loopMin = String(LOOP_MINUTES[i]); b.textContent = ApexRouteCard.loopTime(LOOP_MINUTES[i]); return; }
        const km = ApexCarPlay.LOOP_KM[i], mi = ApexCarPlay.LOOP_MI[i];
        delete b.dataset.loopMin;
        b.dataset.loopMi = String(ApexUnits.metric() ? km / 1.609344 : mi); b.textContent = ApexUnits.metric() ? `${km} km` : `${mi} mi`;
      });
      document.querySelectorAll('#loopBy [data-loop-by]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.loopBy === loopBy)));
      if (plannedRoute) paintCardLoop(plannedRoute);
      carPost(ApexCarPlay.loopsMessage(loopBy, ApexUnits.metric()));   // the car's Loops list is this dial (its units too)
    }
    labelLoops();
    // the dial set to distance or time: its detents and its face change, the detent picked keeps its place
    function setLoopBy(by) {
      by = by === 'time' ? 'time' : 'distance';
      if (by === loopBy) return;
      loopBy = by;
      try { localStorage.setItem(LOOP_BY, by); } catch (_) { /* storage off: this session only */ }
      labelLoops();
      pickLoop(document.querySelector('#loopDetents button[aria-pressed="true"]'));
    }
    document.querySelectorAll('#loopBy [data-loop-by]').forEach((b) => b.addEventListener('click', () => { if (!loopBusy) setLoopBy(b.dataset.loopBy); }));
    // The loop dial (REVIEW.md roadmap 6): a detent picks the length, the dial shows it, Find a loop builds it.
    const LOOP_PICK = 'apex.loopPick';
    function pickLoop(b) {
      if (!b) return;
      document.querySelectorAll('#loopDetents button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      const [val, ...unit] = b.textContent.trim().split(' ');
      $('loopDialVal').textContent = val; $('loopDialUnit').textContent = unit.join(' ');
      const all = [...document.querySelectorAll('#loopDetents button')], i = all.indexOf(b);
      $('loopDialMark').style.transform = `rotate(${-120 + 240 * i / Math.max(1, all.length - 1)}deg)`;
      document.querySelectorAll('#loopTicks line').forEach((l, k) => l.classList.toggle('on', k === i));
      try { localStorage.setItem(LOOP_PICK, String(i)); } catch (_) {}
      $('loopRowLen').textContent = b.textContent.trim();
      // the idle map's "Loop from here · 45 mi" is this dial's loop: it says the length now picked, not the one at launch
      try { paintLoopSuggest(); } catch (_) { /* at launch the deck isn't set up yet; it paints itself */ }
    }
    document.querySelectorAll('#loopDetents button').forEach(b => b.addEventListener('click', () => pickLoop(b)));
    // the folded dial (2026-11-13 IA pass): one row with the length; a tap opens the dial under it
    function openLoopDial(open) { $('loopBody').hidden = !open; $('loopRow').setAttribute('aria-expanded', String(open)); }
    $('loopRow').addEventListener('click', () => openLoopDial($('loopBody').hidden));
    // the ticks on the dial's rim, and turning it: drag round the dial and it clicks to the nearest length
    $('loopTicks').innerHTML = [-120, -60, 0, 60, 120].map((a) => { const r = (a * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r);
      return `<line x1="${(60 + 50 * s).toFixed(1)}" y1="${(60 - 50 * c).toFixed(1)}" x2="${(60 + 58 * s).toFixed(1)}" y2="${(60 - 58 * c).toFixed(1)}"/>`; }).join('');
    { const g = $('loopGauge'); let turning = false;
      const turn = (e) => { const r = g.querySelector('.loop-dial').getBoundingClientRect(), a = Math.atan2(e.clientX - (r.left + r.width / 2), (r.top + r.height / 2) - e.clientY) * 180 / Math.PI;
        const i = Math.max(0, Math.min(4, Math.round((Math.max(-150, Math.min(150, a)) + 120) / 60))), b = document.querySelectorAll('#loopDetents button')[i];
        if (b && b.getAttribute('aria-pressed') !== 'true') { pickLoop(b); b.dispatchEvent(new Event('click')); } };
      g.querySelector('.loop-dial').addEventListener('pointerdown', (e) => { turning = true; g.setPointerCapture(e.pointerId); turn(e); });
      g.addEventListener('pointermove', (e) => { if (turning) turn(e); });
      g.addEventListener('pointerup', () => { turning = false; }); g.addEventListener('pointercancel', () => { turning = false; }); }
    { let i = 2; try { const v = parseInt(localStorage.getItem(LOOP_PICK), 10); if (v >= 0 && v < 5) i = v; } catch (_) {}
      pickLoop(document.querySelectorAll('#loopDetents button')[i]); }
    $('findLoopBtn').addEventListener('click', () => {
      const b = document.querySelector('#loopDetents button[aria-pressed="true"]');
      if (!b) return;
      if (b.dataset.loopMin) loop({ minutes: parseInt(b.dataset.loopMin, 10) }, $('findLoopBtn'));
      else loop(parseFloat(b.dataset.loopMi), $('findLoopBtn'));
    });
    document.querySelectorAll('[data-explore-min]').forEach(b => b.addEventListener('click', () => {
      if (loopBusy || $('planPanel').classList.contains('busy')) return;
      document.querySelectorAll('[data-explore-min]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      exploreNear(parseInt(b.dataset.exploreMin, 10), b);
    }));
    $('deckNearby').addEventListener('click', openNearby);
    $('planNearbyChip').addEventListener('click', openNearby);
    // With the keyboard up the sheet is only the search (index.html, TestFlight 2026-11-12): dragging the list or tapping its
    // background puts the keyboard away, as in any maps app, and the shortcuts and Find a loop come back.
    const typingInPlan = () => document.documentElement.classList.contains('kb-open') && [$('destInput'), $('fromInput')].includes(document.activeElement);
    $('planBody').addEventListener('scroll', () => { if (typingInPlan()) document.activeElement.blur(); }, { passive: true });
    $('planBody').addEventListener('click', (e) => { if (typingInPlan() && !e.target.closest('button, a, input, summary, [role]')) document.activeElement.blur(); });
    $('nearbyClose').addEventListener('click', closeNearby);
    document.querySelectorAll('[data-fun]').forEach(b => b.addEventListener('click', () => changeLevel(b.dataset.fun)));
    setFunLevel(funLevel);
    document.querySelectorAll('[data-avoid]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.avoid;
      setAvoid({ [k]: !avoid[k] });                                       // planned with once the sheet closes
    }));
    setAvoid({});
    function setRoadPrefs(next) {
      roadPrefs = { ...roadPrefs, ...next };
      try { localStorage.setItem(ROAD_PREFS, JSON.stringify(roadPrefs)); } catch (_) { /* storage off: this session only */ }
      for (const k of ['tight', 'fast']) document.querySelectorAll(`[data-pref-${k}]`).forEach(b => { const on = Number(b.getAttribute(`data-pref-${k}`)) === (roadPrefs[k] || 0); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      document.querySelectorAll('[data-prefer]').forEach(b => { const on = !!roadPrefs[b.dataset.prefer]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      paintPresets(); paintOptChips();
    }
    // Prefer stamps (prefer.js, REVIEW.md 3.3): rank what the router gave toward measured, new-to-you or crew-shared roads
    document.querySelectorAll('[data-prefer]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.prefer;
      setRoadPrefs({ [k]: !roadPrefs[k] });
    }));
    // the kinds of corners (was Corner mix, finding 9): Fewer, Any or More hairpins and fast bends, each value named
    for (const k of ['tight', 'fast']) document.querySelectorAll(`[data-pref-${k}]`).forEach(b => b.addEventListener('click', () => {
      setRoadPrefs({ [k]: Math.max(-1, Math.min(1, Number(b.getAttribute(`data-pref-${k}`)) || 0)) });
    }));
    setRoadPrefs({});
    // For this drive (route_ctx/driver.js; vocabulary.js passenger, litRoads, cyclists, tunnels): who's aboard and what to
    // favour, saved on the phone (apex.driverPrefs) and read by the route engine's driver provider. A change re-plans the
    // route on screen as Prefer does. The skill line says how technical a route is offered from your own drives (the Log).
    let driverPrefs = window.ApexRouteDriver ? ApexRouteDriver.load(localStorage) : {};
    const paintDriverPrefs = () => { document.querySelectorAll('[data-driver]').forEach(b => { const on = !!driverPrefs[b.dataset.driver]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); paintOptChips(); };
    document.querySelectorAll('[data-driver]').forEach(b => b.addEventListener('click', () => {
      if (!window.ApexRouteDriver) return;
      const k = b.dataset.driver;
      driverPrefs = ApexRouteDriver.save(localStorage, { ...driverPrefs, [k]: !driverPrefs[k] }); paintDriverPrefs();
    }));
    // findings 4, 5: one Options sheet. Its switches set what the next plan uses; closing it (Done, a swipe down, the dim
    // behind it) plans the route on the card again once, if anything changed, and what is on stays in view as small chips
    // on the plan sheet and the card. A change that can't be planned (no signal) is put back, as before.
    const optState = () => ({ avoid, prefs: roadPrefs, driver: driverPrefs, from: $('fromInput').value });
    let optOpenedWith = null;
    function paintOptChips() {
      if (!window.ApexPlanOptions || !optChipsReady) return;                // (painted once the switches above are read)
      const on = ApexPlanOptions.active(optState());
      // TestFlight 2026-11-12 (note 8, "cluttered"): Where to? says only how many (Options · 3 on, each named to VoiceOver);
      // the route card, planned with them, still shows each one as a chip
      for (const [chipId, boxId] of [['planOptionsChip', null], ['cardOptionsChip', 'cardOptsOn']]) {
        const chip = $(chipId), box = boxId && $(boxId);
        chip.textContent = box ? 'Options' : ApexPlanOptions.chipLabel(on);   // the card's chips beside it name each one: no count to repeat them
        chip.setAttribute('aria-label', on.length ? `Options: ${on.map((x) => x.aria).join(', ')}` : 'Options');
        if (box) box.replaceChildren(...on.map((x) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = x.text; b.dataset.opt = x.key;
          b.setAttribute('aria-label', `${x.aria}. Change in Options`); b.setAttribute('aria-haspopup', 'dialog'); b.addEventListener('click', openOptions); return b; }));
      }
    }
    function openOptions() {
      if (state.mode === 'live') return;
      closeNearby();
      optOpenedWith = { snap: ApexPlanOptions.snapshot(optState()), avoid: { ...avoid }, prefs: { ...roadPrefs }, driver: { ...driverPrefs } };
      $('optSheet').classList.add('open');
      requestAnimationFrame(() => $('optDone').focus());
    }
    // quiet: closed for something else (a loop to fit, a preset, Best roads nearby): no re-plan from here
    async function closeOptions(quiet = false) {
      const sheet = $('optSheet');
      if (!sheet.classList.contains('open')) return;
      sheet.classList.remove('open');
      const was = optOpenedWith; optOpenedWith = null;
      if (quiet || !was || !ApexPlanOptions.changed(was.snap, ApexPlanOptions.snapshot(optState()))) return;
      await replanWithOptions(was);
    }
    async function replanWithOptions(was) {
      const t = plannedRoute;
      if (!t || state.mode === 'live') return;
      for (let k = 0; k < 100 && ($('planPanel').classList.contains('busy') || loopBusy); k++) await new Promise((r) => setTimeout(r, 200));   // the plan in flight first
      if (plannedRoute !== t) return;
      const o = routeOptions;
      if (o && o.kind === 'loop' && o.current === t) { loop(o.targetS ? { minutes: Math.round(o.targetS / 60) } : o.miles); return; }   // the loop again, with them
      const fromChanged = $('fromInput').value.trim() && t.request && t.request.to && t.id === 'route_dest';
      if (fromChanged && JSON.parse(was.snap).from !== $('fromInput').value.trim()) { routeToPlace({ label: fromToName(t.name), lat: t.request.to.lat, lon: t.request.to.lon }); return; }
      if (!(await replanForLevel('With your options'))) {                // couldn't plan it: the switches show the route on screen
        setAvoid(was.avoid); setRoadPrefs(was.prefs);
        if (window.ApexRouteDriver) { driverPrefs = ApexRouteDriver.save(localStorage, was.driver); paintDriverPrefs(); }
      }
    }
    $('planOptionsChip').addEventListener('click', openOptions);
    $('cardOptionsChip').addEventListener('click', openOptions);
    $('cardTuneChip').addEventListener('click', () => { showView('garage'); if (window.ApexGarageSettings && ApexGarageSettings.ui) { if (tuningUi) tuningUi.paint(); ApexGarageSettings.ui.open('tuning'); } });
    $('optDone').addEventListener('click', () => closeOptions());
    optChipsReady = true;
    paintDriverPrefs();
    (async () => {
      try {
        const sums = window.ApexRouteDriver ? await ApexRecording.summaries(null) : null, k = sums && ApexRouteDriver.skillTrend(sums), n = $('skillNote');
        if (k && n) { n.textContent = ApexRouteDriver.skillLine(k); n.hidden = false; }
      } catch (_) { /* no Log yet: no line */ }
    })();
    // Loop to fit (route_ctx/ios_context.js): the next event's start or the album's length, from the phone, only in the app and
    // only when tapped (iOS asks for the permission at that tap). The provider then marks routes that run past it.
    if (window.ApexIosContext && ApexIosContext.available() && $('fitRow')) { $('fitRow').hidden = false; $('fitCtl').hidden = false; }
    document.querySelectorAll('[data-fit]').forEach(b => b.addEventListener('click', async () => {
      if (!window.ApexIosContext || loopBusy) return;
      const op = b.dataset.fit === 'album' ? 'music' : 'calendar';
      const p = ApexIosContext.plan(op, await ApexIosContext.ask(op));
      if (op === 'calendar' && p.minutes) ApexIosContext.state.nextEventAt = p.next || null;
      if (op === 'music' && p.minutes) ApexIosContext.state.albumEndsAt = p.endsAt;
      toast(p.text); if ($('fitNote')) $('fitNote').textContent = p.text;   // the toast gives way to the loop's own; the note stays
      if (p.minutes) { closeOptions(true); loop({ minutes: p.minutes }); }
    }));
    // (an hour or two of driving, home again, R-16: the dial's own once it could be set by time; Options had a second copy)
    // Presets (plan_presets.js): this setup under a name, a stamp at the top of the sheet; tapping one sets it all at once.
    function paintPresets() {
      const row = $('presetRow');
      if (!row || typeof roadPrefs === 'undefined') return;
      const list = ApexPlanPresets.list(localStorage), on = ApexPlanPresets.matching(localStorage, { fun: funLevel, avoid, prefs: roadPrefs });
      row.hidden = !list.length;
      row.replaceChildren(...list.map(p => {
        const b = document.createElement('button'); b.textContent = p.name;
        b.setAttribute('aria-pressed', String(!!on && on.name === p.name));
        b.addEventListener('click', async () => {
          if ($('planPanel').classList.contains('busy') || loopBusy) return;
          if (on && on.name === p.name) {                                   // already set: the one thing left to do is remove it
            toast(`${p.name} is set.`, { label: 'Remove preset', ms: 6000, onClick: () => { ApexPlanPresets.remove(localStorage, p.name); paintPresets(); } });
            return;
          }
          const was = { fun: funLevel, avoid: { ...avoid }, prefs: { ...roadPrefs } };
          closeOptions(true);
          setFunLevel(p.fun); setAvoid(Object.fromEntries(Object.keys(FunRoute.AVOID_LABELS).map(k => [k, !!p.avoid[k]]))); setRoadPrefs(p.prefs);
          if (!(await replanForLevel(p.name))) { setFunLevel(was.fun); setAvoid(was.avoid); setRoadPrefs(was.prefs); }
        });
        return b;
      }));
    }
    $('presetSaveBtn').addEventListener('click', async () => {
      const name = await ApexConfirm.prompt('Name this setup', { action: 'Save', placeholder: 'Sunday loop, Night run', maxLength: 40 });
      if (!name || !name.trim()) return;
      const r = ApexPlanPresets.save(localStorage, { name, fun: funLevel, avoid, prefs: roadPrefs });
      toast(r === 'saved' ? `${name.trim()} is a preset: it's under Presets in Options.` : r === 'full' ? `You have ${ApexPlanPresets.MAX} presets. Tap one that is set to remove it.` : 'Couldn\u2019t save that preset.');
      paintPresets();
    });
    paintPresets();
    $('routeDriveBtn').addEventListener('click', () => {
      if (!plannedRoute) return;
      booting = false;
      if (track !== plannedRoute) activate(plannedRoute, 0);
      closeSheet();
      startDrive();
    });
    // Owner only (IDEAS Y-03): the week's app health totals, as rates where there is one (backend/src/health.ts). Anonymous.
    function healthSection() {
      const sec = el('div', { className: 'stack-8' }, el('h3', { textContent: 'App health this week' }));
      apiCall('GET', '/api/ops/app-health?days=7').then(jsonOf).then((r) => {
        const rows = r && Array.isArray(r.rows) ? r.rows : null;
        if (!rows) { sec.append(el('p', { className: 'note', textContent: 'Couldn\'t load the counts.' })); return; }
        if (!rows.length) { sec.append(el('p', { className: 'note', textContent: 'No reports in the last 7 days.' })); return; }
        const get = (app, m) => (rows.find((x) => x.app === app && x.metric === m) || { n: 0 }).n;
        const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '--');
        for (const app of [...new Set(rows.map((x) => x.app))]) {
          const routes = get(app, 'route_ok') + get(app, 'route_fail'), uploads = get(app, 'road_upload_ok') + get(app, 'road_upload_fail');
          const locks = get(app, 'calib_locked');
          sec.append(el('p', { className: 'note', textContent: [`${app === 'ios' ? 'iPhone app' : 'Website'}: ${get(app, 'drives')} drives`,
            `routing failed ${pct(get(app, 'route_fail'), routes)} of ${routes}`, `fallback router ${get(app, 'route_fallback')}×`,
            `road uploads failed ${pct(get(app, 'road_upload_fail'), uploads)} of ${uploads}`,
            `mount set in ${locks ? Math.round(get(app, 'calib_lock_s') / locks) + ' s' : '--'} on average`,
            `${get(app, 'hazard_queued')} reports queued with no signal`, `${get(app, 'crash_asked')} crash checks`].join(' · ') }));
        }
      }).catch(() => sec.append(el('p', { className: 'note', textContent: 'Couldn\'t load the counts.' })));
      return sec;
    }
    // Owner only (IDEAS Y-17): the API's week, per route: requests, error rates and latency (backend/src/stats.ts), busiest first.
    function latencySection() {
      const sec = el('div', { className: 'stack-8' }, el('h3', { textContent: 'Server this week' }));
      apiCall('GET', '/api/ops/latency?days=7').then(jsonOf).then((r) => {
        const rows = r && Array.isArray(r.rows) ? r.rows : null;
        if (!rows) { sec.append(el('p', { className: 'note', textContent: 'Couldn\'t load the numbers.' })); return; }
        if (!rows.length) { sec.append(el('p', { className: 'note', textContent: 'No requests sampled in the last 7 days.' })); return; }
        const pct = (a, b) => (b ? `${(Math.round((1000 * a) / b) / 10)}%` : '--');
        for (const x of rows.slice(0, 15)) sec.append(el('p', { className: 'note', textContent:
          `${x.route} · ~${x.n.toLocaleString('en-US')} requests · ${x.s5xx} server errors · ${pct(x.s4xx, x.n)} refused · mean ${x.mean_ms ?? '--'} ms · p95 ${x.p95_ms ?? '--'} ms` }));
      }).catch(() => sec.append(el('p', { className: 'note', textContent: 'Couldn\'t load the numbers.' })));
      return sec;
    }
    // Owner only (IDEAS Y-16): the week's crash and server-error counts (backend/src/errors.ts), most frequent first. Anonymous.
    function errorsSection() {
      const sec = el('div', { className: 'stack-8' }, el('h3', { textContent: 'Errors this week' }));
      apiCall('GET', '/api/ops/errors?days=7').then(jsonOf).then((r) => {
        const rows = r && Array.isArray(r.errors) ? r.errors : null;
        if (!rows) { sec.append(el('p', { className: 'note', textContent: 'Couldn\'t load the counts.' })); return; }
        if (!rows.length) { sec.append(el('p', { className: 'note', textContent: 'No errors in the last 7 days.' })); return; }
        for (const e of rows.slice(0, 25)) {
          const d = el('details', {}, el('summary', { textContent: `${e.n}× ${e.source} · ${e.kind} · ${e.message}` }),
            el('p', { className: 'note', textContent: [e.page && `page ${e.page}`, `${e.days} day${e.days === 1 ? '' : 's'}`, `last ${e.last_at}`].filter(Boolean).join(' · ') }),
            ...(e.stack ? [el('pre', { textContent: e.stack, style: 'white-space:pre-wrap;font-size:11px;max-height:160px;overflow:auto' })] : []));
          sec.append(d);
        }
      }).catch(() => sec.append(el('p', { className: 'note', textContent: 'Couldn\'t load the counts.' })));
      return sec;
    }
    // Owner only (the owner, 2026-11-12): the service check (web/service_check.js, lazy 'ops'). Asks every service the app
    // leans on from this phone, at a fixed test place, and sends what it saw to the Worker (backend/src/service_check.ts),
    // where Claude reads it in D1. Runs on its own once a launch at most every SVC_EVERY_MS, and on Run check.
    const SVC_KEY = 'apex.svccheck.at', SVC_EVERY_MS = 6 * 3600e3;
    let svcRun = null, svcAway = 0;
    document.addEventListener('visibilitychange', () => { if (document.hidden) svcAway++; });
    function serviceCheckDeps() {
      const AT = ApexServiceCheck.AT, TO = ApexServiceCheck.TO;
      const own = () => (ownOn() ? ownRouter() : null);
      return {
        fetch: (u, i) => fetch(u, i),
        apiFetch: (path, init) => ApexSync.apiFetch(path, init),
        apiBase: ApexSync.inApp ? ApexSync.apiBase : '',
        plan: (level) => ApexOwnRouting.plan(own(), { from: AT, to: TO, level, prefs: roadPrefs, avoid, heading: null }),
        loops: async () => {
          const c = own();
          if (!c) return { cands: [], reason: 'off' };
          if (!(await c.covers([AT]))) return { cands: [], reason: 'out' };
          try { const r = await c.loop({ start: AT, km: 40, level: LOOP_STYLE }); return { cands: (r && r.routes) || [], reason: r && r.routes && r.routes.length ? 'ok' : 'none' }; }
          catch (e) { return { cands: [], reason: 'failed', error: String((e && e.message) || e) }; }
        },
        // the app's own path (our region list first, then the Overpass servers), with nothing read from this phone's cache
        cameras: (tile) => ApexCameras.load([tile], { fetchFn: fetch, storage: null }),
        cameraQuery: (tile) => ApexCameras.query([tile]),
        away: () => svcAway, hidden: () => document.hidden,   // a probe the page was hidden through is not judged
      };
    }
    /** Resolves true once the page is shown (now, or within ms), false when it stays hidden that long. */
    function svcShown(ms) {
      if (!document.hidden) return Promise.resolve(true);
      return new Promise((done) => {
        const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); clearTimeout(t); done(true); } };
        const t = setTimeout(() => { document.removeEventListener('visibilitychange', on); done(false); }, ms);
        document.addEventListener('visibilitychange', on);
      });
    }
    /** Runs the check once (a second ask while one runs gets the same run) and sends it. Resolves { results, sent }. */
    function runServiceCheck() {
      if (svcRun) return svcRun;
      svcRun = (async () => {
        await ApexLazy.load('ops');
        try { localStorage.setItem(SVC_KEY, String(Date.now())); } catch (_) {}
        let results = await ApexServiceCheck.run(serviceCheckDeps());
        // a probe the app was hidden through isn't judged; ask those once more when the page is back (within 10 min)
        const again = results.filter((x) => x.state === 'skip' && /background/.test(x.detail)).map((x) => x.id);
        if (again.length && await svcShown(600e3)) {
          const redo = new Map((await ApexServiceCheck.run(serviceCheckDeps(), again)).map((x) => [x.id, x]));
          results = results.map((x) => redo.get(x.id) || x);
        }
        let sent = false;
        try { const r = await apiCall('POST', '/api/ops/service-check', ApexServiceCheck.report(results, { ua: navigator.userAgent, online: navigator.onLine })); sent = !!(r && r.ok); } catch (_) { sent = false; }
        return { results, sent, at: Date.now() };
      })().finally(() => { svcRun = null; });
      return svcRun;
    }
    function serviceCheckDue() {
      let at = 0; try { at = Number(localStorage.getItem(SVC_KEY)) || 0; } catch (_) {}
      return Date.now() - at > SVC_EVERY_MS;
    }
    let svcLast = null;
    function serviceCheckSection() {
      const sec = el('div', { className: 'stack-8 svc-check' }, el('h3', { textContent: 'Service check' }),
        el('p', { className: 'note', textContent: 'Asks every server the app uses, from this phone, at a test spot in downtown Cincinnati (never where you are). The results go to Vetta’s server, where Claude can read them.' }));
      const out = el('div', { className: 'stack-8' });
      const go = btn('Run check', () => show(runServiceCheck()));
      sec.append(el('div', { className: 'row' }, go), out);
      const dot = { up: '\u{1F7E2}', slow: '\u{1F7E1}', down: '\u{1F534}', skip: '⚪' };
      const word = { up: 'up', slow: 'slow', down: 'down', skip: 'not run' };
      function paint(r) {
        out.replaceChildren();
        const P = ApexServiceCheck.PROBES;
        out.append(el('p', { className: 'note', textContent: `${ApexServiceCheck.summary(r.results)}. ${r.sent ? 'Sent to Vetta’s server.' : 'Couldn’t send it to Vetta’s server.'} ${new Date(r.at).toLocaleTimeString()}` }));
        for (const g of [...new Set(P.map((p) => p.group))]) {
          out.append(el('h4', { textContent: g }));
          for (const p of P.filter((x) => x.group === g)) {
            const x = r.results.find((y) => y.id === p.id);
            if (!x) continue;
            const line = [`${dot[x.state] || ''} ${p.name}: ${word[x.state] || x.state}`, x.ms ? `${(x.ms / 1000).toFixed(1)} s` : null, x.detail || null].filter(Boolean).join(' · ');
            out.append(el('p', { className: 'note', textContent: line }),
              ...(x.state === 'down' ? [el('p', { className: 'note', textContent: `Affects: ${p.feeds}.`, style: 'margin-top:-6px' })] : []));
          }
        }
        out.append(serverSide());
      }
      function serverSide() {
        const box = el('div', { className: 'stack-8' }, el('h4', { textContent: 'From Vetta’s server' }));
        apiCall('GET', '/api/ops/service-check/server').then(jsonOf).then((s) => {
          if (!s || !s.config) { box.append(el('p', { className: 'note', textContent: 'Couldn’t ask the server.' })); return; }
          const missing = Object.entries(s.config).filter(([, v]) => !v).map(([k]) => k);
          box.append(el('p', { className: 'note', textContent: `Database ${s.db ? 'answers' : 'not answering'} · ${missing.length ? `not set: ${missing.join(', ')}` : 'every binding and secret set'}` }),
            el('p', { className: 'note', textContent: `Road graph on GitHub: ${s.graph_data.http === 200 ? `${s.graph_data.tiles} tiles` : `HTTP ${s.graph_data.http || '--'} ${s.graph_data.error || ''}`} · ${(s.graph_data.ms / 1000).toFixed(1)} s` }),
            ...s.overpass.map((o) => el('p', { className: 'note', textContent: `${o.elements != null ? dot.up : dot.down} Overpass ${o.host} from the server: ${o.elements != null ? `${o.elements} features` : `HTTP ${o.http || '--'} ${o.error || ''}`} · ${(o.ms / 1000).toFixed(1)} s` })));
          // the usage guard (backend src/usage.ts): this month against the $5 plan's included amounts
          const u = s.usage;
          if (u && u.share) {
            const pct = (x) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;
            const until = u.until ? new Date(u.until).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
            box.append(el('p', { className: 'note', textContent: `${u.shedding ? dot.down : dot.up} This month of the $5 plan: database reads ${pct(u.share.d1_read)}, writes ${pct(u.share.d1_written)} · storage writes ${pct(u.share.kv_write)}, reads ${pct(u.share.kv_read)}${u.share.r2_b != null ? ` · map data reads ${pct(u.share.r2_b)}, writes ${pct(u.share.r2_a)}` : ''}${u.shedding ? ` · uploads and photos paused until ${until}` : ` · uploads pause at ${Math.round(u.shed_at * 100)}%`}` }));
          }
        }).catch(() => box.append(el('p', { className: 'note', textContent: 'Couldn’t ask the server.' })));
        return box;
      }
      function show(p) {
        go.disabled = true; go.textContent = 'Checking…';
        out.replaceChildren(el('p', { className: 'note', textContent: 'Asking every service. Our router’s three plans take up to a minute.' }));
        p.then((r) => { svcLast = r; paint(r); })
          .catch(() => out.replaceChildren(el('p', { className: 'note', textContent: 'The check couldn’t run (its file didn’t load).' })))
          .finally(() => { go.disabled = false; go.textContent = 'Run again'; });
      }
      if (svcRun) show(svcRun); else if (svcLast) { paint(svcLast); go.textContent = 'Run again'; }
      return sec;
    }
    // ---- planned routes shared with friends and crews (IDEAS S-05; backend/src/routes_shared.ts) ----------------------
    // The shape only, thinned to 1,500 points, without the first 400 m (where you are when you plan is often home).
    const SHARE_TRIM_M = 400, SHARE_MAX_PTS = 1500;
    function sharedGeom(t) {
      const n = t.lat.length, from = t.dist.findIndex(d => d >= SHARE_TRIM_M), step = Math.max(1, Math.ceil((n - Math.max(0, from)) / SHARE_MAX_PTS));
      const out = [];
      for (let i = Math.max(0, from); i < n; i += step) out.push([+t.lon[i].toFixed(5), +t.lat[i].toFixed(5)]);
      if (out.length && (out[out.length - 1][0] !== +t.lon[n - 1].toFixed(5))) out.push([+t.lon[n - 1].toFixed(5), +t.lat[n - 1].toFixed(5)]);
      return out.slice(0, SHARE_MAX_PTS);
    }
    // A friend's row (REVIEW_PEOPLE P-04 "Share a route") picks them here: the next share opens with them chosen.
    let shareTo = null;
    function shareRouteWith(handle) {
      shareTo = handle;
      showView(null); openPlan(true);
      // the panel emptied first: Share opens and closes it
      if (plannedRoute) { $('routeSharePick').replaceChildren(); $('routeShareBtn').click(); setTimeout(() => $('routeSharePick').scrollIntoView({ block: 'nearest' }), 50); }
      else { $('destInput').focus(); toast(`Plan a route, then Share on its card: @${handle} is picked.`); }
    }
    $('routeShareBtn').addEventListener('click', async () => {
      const t = plannedRoute, box = $('routeSharePick');
      // Share opens and closes its panel, so the panel has no Cancel of its own under the route card's Cancel (which drops the route)
      if (box.childElementCount) { box.replaceChildren(); return; }
      if (!t || !Array.isArray(t.lat) || t.lat.length < 2) return;
      box.replaceChildren(el('p', { className: 'note', textContent: 'Loading your friends and crews…' }));
      let friends = [], crews = [];
      try { [friends, crews] = await Promise.all([apiCall('GET', '/api/friends').then(jsonOf), apiCall('GET', '/api/crews').then(jsonOf)]); } catch (_) {}
      const fr = (friends || []).filter(f => f.status === 'accepted' && f.handle), cr = crews || [];
      // the road can also go into one of your roadbooks (roadbooks.js addPart), friends or none
      const bookPart = () => { const p = roadbooks && accountMe && accountMe.member ? roadbooks.addPart(() => box.replaceChildren()) : null; return p ? [p] : []; };
      if (!fr.length && !cr.length) {
        const books = bookPart();                                        // signed in with nobody to send it to yet: the roadbook is the way to keep it
        box.replaceChildren(el('p', { className: 'note', textContent: books.length ? 'Add friends or a crew in People to send routes to them.' : 'No friends or crews to share with yet. Add them in People.' }), ...books);
        if (books.length) box.scrollIntoView({ block: 'nearest' });
        return;
      }
      const picked = { friends: new Set(), crews: new Set() };
      if (shareTo && fr.some(f => f.handle === shareTo)) picked.friends.add(shareTo);
      shareTo = null;
      // Nate 2026-11-12 (as easy as a big social app): before Send, one line says who gets it and what goes, and follows the picks
      const goes = el('p', { className: 'note share-goes', 'aria-live': 'polite' });
      const paintGoes = () => {
        const who = [...[...picked.friends].map(h => '@' + h), ...cr.filter(c => picked.crews.has(c.id)).map(c => c.name)];
        const names = who.length > 3 ? `${who.slice(0, 2).join(', ')} and ${who.length - 2} more` : who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}` : who[0];
        goes.textContent = who.length ? `Goes to ${names}. The line only, first 400 m hidden.` : 'Pick who gets it. The line only, first 400 m hidden.';
      };
      const chip = (label, set, key) => { const b = el('button', { className: 'ink-btn' + (set.has(key) ? ' on' : ''), textContent: label }); b.setAttribute('aria-pressed', String(set.has(key)));
        b.onclick = () => { if (set.has(key)) set.delete(key); else set.add(key); b.classList.toggle('on', set.has(key)); b.setAttribute('aria-pressed', String(set.has(key))); paintGoes(); }; return b; };
      paintGoes();
      box.replaceChildren(el('div', { className: 'row', style: 'flex-wrap:wrap' }, ...fr.map(f => chip('@' + f.handle, picked.friends, f.handle)), ...cr.map(c => chip(c.name, picked.crews, c.id))),
        goes,
        el('div', { className: 'row' }, btn('Send', async () => {
          if (!picked.friends.size && !picked.crews.size) { toast('Pick who to share it with.'); return; }
          const r = await apiCall('POST', '/api/routes', { name: t.name || 'Route', geom: sharedGeom(t), friends: [...picked.friends], crews: [...picked.crews] });
          const j = await jsonOf(r);
          if (!r.ok) { toast(r.status === 429 ? 'That\'s a lot of shares today.' : 'Couldn\'t share it. Try again.'); return; }
          toast(j && j.shared ? `Shared. They'll find it in People.` : 'Nobody to share it with.'); box.replaceChildren();
        }, 'ink-btn solid')), ...bookPart());
      box.scrollIntoView({ block: 'nearest' });
    });
    // From friends (REVIEW_PEOPLE P-13/P-14): what friends shared with you, newest first, with when; `list` is the render's read.
    const sharedWhen = (at) => { const t = Date.parse(String(at || '').replace(' ', 'T') + 'Z'); return Number.isFinite(t) && window.ApexFriendsMap ? ApexFriendsMap.spokenAgo(t) : ''; };
    function sharedRoutesSection(onCount, list = null) {
      const sec = el('div', { className: 'stack-8' }, el('h3', { textContent: 'From friends' }));
      (list || apiCall('GET', '/api/routes/shared').then(jsonOf)).then((list) => {
        if (onCount) onCount(Array.isArray(list) ? list.length : 0);
        if (!Array.isArray(list) || !list.length) { sec.append(el('p', { className: 'note', textContent: 'No routes shared with you yet. Share one from a route card.' })); return; }
        for (const r of list) sec.append(el('div', { className: 'row', style: 'align-items:center' },
          el('span', { style: 'flex:1', textContent: `${r.name} · from @${r.from_handle || '?'}${sharedWhen(r.created_at) ? ` · ${sharedWhen(r.created_at)}` : ''}` }),
          btn('Open', () => openSharedRoute(r.id), 'ink-btn')));
      }).catch(() => sec.append(el('p', { className: 'note', textContent: 'Couldn\'t load shared routes. Check signal.' })));
      return sec;
    }
    async function openSharedRoute(id) {
      const r = await apiCall('GET', `/api/routes/${encodeURIComponent(id)}`);
      const j = r.ok ? await jsonOf(r) : null;
      if (!j || !Array.isArray(j.geom) || j.geom.length < 2) { toast('That route isn\'t shared with you any more.'); return; }
      closeSheet && closeSheet();
      const t = await trackFromPolyline(j.geom, `shared_${id}`, j.name);
      await buildRoute(null, t.id, j.name, t);
      toast(`${j.name} from @${j.from_handle || '?'}: ${ApexUnits.long(totalM(), 1)}.`);
    }
    $('routePreviewBtn').addEventListener('click', () => {
      if (!plannedRoute) return;
      booting = false;
      replayOn = true;
      closeSheet();
      if (track !== plannedRoute) activate(plannedRoute, 0);
      setMode('sim');
      setPlaying(true);
      render(true);
    });

    // Account (optional; docs/BACKEND.md). The panel only appears when /api answers, so the app stays fully local without it.
    // Through ApexSync.apiFetch: same-origin cookie on the web, the Worker with a bearer token in the iOS app.
    async function apiCall(method, path, body) {
      return ApexSync.apiFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    }
    // Saved routes and pinned places on your account (item_sync.js, big bet #11): once the account answers, and 1.5 s after a
    // save, a removal, a pin or an unpin here; one at a time, and at most once a minute otherwise. What it brings is drawn.
    let itemSyncing = null, itemSyncAt = 0, itemSyncAgain = false, itemsTimer = 0;
    function syncItems(force) {
      if (!window.ApexItemSync || !accountMe || !accountMe.id) return;
      if (itemSyncing) { if (force) itemSyncAgain = true; return; }
      if (!force && Date.now() - itemSyncAt < 60_000) return;
      itemSyncAt = Date.now();
      itemSyncing = ApexItemSync.sync(localStorage, ApexSavedRoutes, ApexPinnedPlaces, accountMe.id, apiCall)
        .then((r) => {
          if (!r || !r.pulled) return;
          carPost(carPlaces()); if ($('planPanel').classList.contains('open') && !$('destInput').value.trim()) renderPlaces();
          // a route saved on another phone was saved for offline there: its map is kept here too, quietly, one at a time
          const came = ApexSavedRoutes.list(localStorage).filter((p) => (r.routes || []).includes(p.id));
          came.reduce((go, p) => go.then(() => keepMapAlong({ id: p.id, name: p.name, lat: p.coords.map((c) => c[1]), lon: p.coords.map((c) => c[0]) }, true)), Promise.resolve());
        })
        .catch((e) => console.error('item sync', e))
        .finally(() => { itemSyncing = null; if (itemSyncAgain) { itemSyncAgain = false; syncItems(true); } });
    }
    function itemsChanged() { clearTimeout(itemsTimer); itemsTimer = setTimeout(() => syncItems(true), 1500); }
    // "Sign in with Google" links: the app signs in through the native shell instead of following the link.
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href="/api/auth/google/start"]');
      if (a && ApexSync.inApp) { e.preventDefault(); ApexSync.signIn(); }
      if (e.target.closest && e.target.closest('[data-apple-signin]')) ApexSync.signInApple();
    });
    // Sign in with Apple (IDEAS O-05, App Review 4.8): in the app only, first and as prominent as Google.
    if (ApexSync.inApp) document.querySelectorAll('[data-apple-signin]').forEach((b) => { b.hidden = false; });
    const appleButton = () => { const b = el('button', { className: 'apple-btn', textContent: '\uF8FF Sign in with Apple', hidden: !ApexSync.inApp }); b.setAttribute('data-apple-signin', ''); return b; };
    const jsonOf = async (r) => { try { return await r.json(); } catch (_) { return null; } };
    // 'aria-label', 'aria-hidden' and the like are attributes, not properties: Object.assign alone dropped them (People's gear had no name)
    const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag);
      for (const [k, v] of Object.entries(props)) { if (k.includes('-')) n.setAttribute(k, v); else n[k] = v; }
      n.append(...kids); return n; };
    const btn = (label, onclick, cls = 'ink-btn') => el('button', { className: cls, textContent: label, onclick });
    // Every invite and share link (feedback 07): the real share sheet (save_file.js shareLink), the clipboard only on a web
    // page without one; a toast when it was copied or couldn't be, never a "Copy this link" box.
    const copyText = async (text, ok, title = 'Vetta') => {
      const isUrl = /^https?:/.test(text);
      const how = await ApexSaveFile.shareLink({ title, text: isUrl ? title : text, url: isUrl ? text : '' });
      if (how === 'copied') toast(ok);
      else if (how === 'failed') toast('Couldn\'t open the share sheet. Try again.');
    };
    const section = (title) => el('div', { className: 'stack-8' }, el('h3', { textContent: title }));
    // F-03 (REVIEW_FEEL): People, the Garage, crews, builds, the convoy and friends on the map are not on the launch path
    // (web/lazy.js 'social'). Their mounts below wait in order and run the moment the files are in: on first use (a People or
    // Garage tab, the Friends layer, Convoy now, a link) or once the map is idle after the launch, so a convoy resumes, an
    // invite shows and friends see you drive without a tap. Until then each is null, as when a module is missing.
    const socialMounts = [];
    const onSocial = (fn) => socialMounts.push(fn);
    let socialReady = null, socialIn = false, socialFailed = false;
    function needSocial() {
      if (!socialReady) { socialFailed = false; socialReady = ApexLazy.load('social').then(() => {
        for (const fn of socialMounts.splice(0)) fn();
        socialIn = true;
        renderAccount();                                                  // People and the Garage were drawn without them
        refreshDriveToday().catch(() => {});
      }).catch((e) => { socialReady = null; socialFailed = true; console.error('social', e); renderAccount(); }); }   // offline website: draw without, ask again next time
      return socialReady;
    }
    // Convoy (web/convoy_ui.js): a live group drive. The page lends it the map, the position, the voice and its helpers.
    let convoy = null;
    onSocial(() => { try { convoy = window.ApexConvoyUI && window.ApexConvoy ? ApexConvoyUI.mount({
      map, maplibregl, el, btn, toast, copyText, showView, apiFetch: ApexSync.apiFetch, overlayParent: $('toast').parentElement,
      reportSheet: $('hzOverlay'),                                     // the Report key's sheet: the leader's convoy calls go on top
      driving: () => driveActive,
      siteOrigin: () => ApexSync.siteBase,
      wsUrl: (id) => `${ApexSync.inApp ? ApexSync.apiBase.replace(/^http/, 'ws') : location.origin.replace(/^http/, 'ws')}/api/convoy/${encodeURIComponent(id)}/connect`,
      getFix: () => {
        const p = state.lastPosition;
        if (!p || !state.lastPositionAt || performance.now() - state.lastPositionAt > 10000) return null;
        if (inPrivacyZone(p.lat, p.lon)) return null;                     // a privacy zone: the convoy gets no position
        const m = state.lastMotion || {};
        return { lat: p.lat, lon: p.lon, heading: m.heading ?? null, speedMps: m.speedMps ?? null };
      },
      getRoute: () => (track && track.kind === 'route' && track.lat.length > 1 ? { name: track.name, pts: track.lat.map((la, i) => [la, track.lon[i]]) } : null),
      // A close hazard cuts in; a far one goes next, after the pace note being spoken (never dropping the notes queued).
      // With the voice off a close one still alerts on the car's screen, as it does with the voice on (the phone toasts it).
      speak: (text, urgent) => { if (!state.toggles.voice) { toast(text); if (urgent && driveActive) carPost({ kind: 'hazard', title: text }); } else if (urgent) say(text, true, null, null, { kind: 'hazard', alert: true }); else sayNext(text, `convoy:${text}`); },
      onRegroup: (rg, convoyName) => regroupSay(rg, convoyName),
      drive: () => startDrive(),                                       // the convoy sheet's "Start the drive" (Convoy now, P-11)
    }) : null; } catch (e) { console.error('convoy', e); convoy = null; } });   // the convoy never takes the page down
    // Garage (web/garage_ui.js): your cars, and the ones friends and crew-mates show.
    // Block and report (web/safety_ui.js) on every social surface below; the garage uses it for friends' cars.
    let safety = null;
    onSocial(() => { try { safety = window.ApexSafetyUI ? ApexSafetyUI.mount({ el, btn, toast, apiCall, jsonOf }) : null; } catch (e) { console.error('safety', e); } });
    // Crew drives (web/crew_events.js, IDEAS S-06): planned drives across your crews, RSVPs, and the day's convoy.
    // Sharing on by default (the owner, 2026-11-11; backend/src/share_defaults.ts): friends and private crews share Scores and
    // Times from the start, a public crew nothing, so joining one asks once. Cancel keeps it off; the crew's page switches it.
    async function askPublicSharing(crewId, name) {
      try { localStorage.setItem(`apex.askedShare.${crewId}`, '1'); } catch (_) {}
      if (!window.ApexConfirm || !ApexConfirm.choose) return;
      const pick = await ApexConfirm.choose(`Share your drives with ${name || 'this crew'}? It's a public crew: anyone can join it and see what you share. Switch it off any time on the crew's page.`,
        [{ key: 'both', label: 'Share Scores and times' }, { key: 'scores', label: 'Scores only' }]);
      if (!pick) return;
      const r = await apiCall('PUT', '/api/grants', { audience_type: 'crew', audience_id: crewId, share_scores: true, share_times: pick === 'both' }).catch(() => null);
      toast(r && r.ok ? (pick === 'both' ? `${name} sees your Scores and times.` : `${name} sees your Scores.`) : 'Couldn\u2019t change that. Switch it on from the crew\u2019s page.');
    }
    let crewEvents = null;
    onSocial(() => { try { crewEvents = window.ApexCrewEvents ? ApexCrewEvents.mount({ el, btn, toast, apiCall, jsonOf, report: safety && safety.report, askPublicSharing,
      here: () => state.lastPosition || null, mapCentre: () => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; }, mayLookUp: nearLookupOk,
      myHandle: () => (accountMe && accountMe.handle) || null,
      plannedRoute: () => (plannedRoute && plannedRoute.lat.length > 1 ? { name: plannedRoute.name, geom: sharedGeom(plannedRoute) } : null),
      goTo: (p) => { closeSheet(); routeToPlace(p); }, openRoute: (id) => openSharedRoute(id),
      // the run as one card (REVIEW_PEOPLE.md P-03, P-11): the convoy lives on it; "Meet at…" is Where to?'s own search (P-10)
      convoy: () => convoy, avatar: (id, h, px) => (window.ApexPhotos ? ApexPhotos.avatar(id, h, px) : null),
      searchPlaces: async (q) => {
        let segs = [];
        try { segs = JSON.parse(localStorage.getItem('apex.segments') || '[]'); } catch (_) {}
        const mine = ApexPlaceSearch.localMatches(q, segs, loadHighlights()).map((m) => ({ label: m.label, sub: m.kind, lat: m.lat, lon: m.lon }));
        let rows;
        try { rows = (IN_APP_SHELL && await appleSuggest(q)) || await photonSuggest(q); } catch (_) { return mine.length ? mine : null; }
        return [...mine, ...rows.filter((r) => !mine.some((m) => ApexPlaceSearch.norm(m.label) === ApexPlaceSearch.norm(r.label)))];
      },
      resolvePlace: (r) => (r && r.apple ? appleResolve(r) : Promise.resolve(null)),
      openWhereTo: () => { toast('Plan the route, then plan the drive.'); showView('route'); },
    }) : null; } catch (e) { console.error('crew drives', e); } });
    // A regroup call in a convoy (crew_voice.js): a Factory crew's own line in the theme pack's voice when the convoy is the
    // crew's and the clip exists; otherwise "Regroup at <note>" like any other line. The note is always on screen.
    let crewVoiceList = null;
    async function regroupSay(rg, convoyName) {
      if (!state.toggles.voice) { toast(ApexCrewVoice.regroupText(rg)); return; }
      if (crewVoiceList === null && accountMe && accountMe.member) crewVoiceList = await apiCall('GET', '/api/crews/voices').then(jsonOf).catch(() => []) || [];
      const crew = ApexCrewVoice.crewOf(convoyName, crewVoiceList || []), pack = ['marguerite', 'kit', 'hale'].includes(state.voiceId) ? state.voiceId : 'marguerite';
      if (crew && crew.packs.includes(pack)) {
        try {
          const r = await ApexSync.apiFetch(`/api/crews/${encodeURIComponent(crew.id)}/voice/${pack}`);
          if (r.ok) {
            const c = ApexVoice.unlock(), buf = await c.decodeAudioData(await r.arrayBuffer()), src = c.createBufferSource();
            src.buffer = buf; src.connect(c.destination); src.start();
            if (rg.note) toast(`Regroup at ${rg.note}.`);
            return;
          }
        } catch (_) { /* no clip after all: the plain line */ }
      }
      say(ApexCrewVoice.regroupText(rg), false, null, null, { tokens: [rg && rg.note ? 'line:regroup' : 'line:regroup_set'], named: true });
    }
    // A crew link (P-02, P-07): any member makes one unless the owner keeps invites; whoever opens it and signs in joins the
    // crew and is friends with the sender, so the one link is the whole way in.
    const crewInviteLink = async (c) => {
      const r = await apiCall('POST', `/api/crews/${c.id}/invite`); const j = await jsonOf(r);
      if (r.ok) copyText(`${shareOrigin()}/?crew=${j.token}`, `Crew link copied. Whoever opens it joins ${c.name} and is your friend.`, `Join ${c.name} on Vetta`);
      else toast(j && j.error === 'too_many_open_invites' ? 'You have 10 open crew links. Turn some off first.' : j && j.error === 'owner_invites_only' ? `Only the owner invites to ${c.name}.` : 'Couldn\'t make a link. Try again.');
    };
    // The crew page (web/crew_page.js, REVIEW.md roadmap 20): the Crew tab opens your crew.
    let crewPage = null, crewDrivesEl = null;
    // in a crew, Crew drives is a row on the Crews side that opens its sheet; not in one, the section on the side itself
    const toDrives = () => { const pop = crewDrivesEl && crewDrivesEl.closest('.side-pop'); if (pop) pop.classList.add('open'); else if (crewDrivesEl) crewDrivesEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    onSocial(() => { try { crewPage = window.ApexCrewPage ? ApexCrewPage.mount({ el, btn, toast, apiCall, jsonOf, report: safety && safety.report, askPublicSharing,
      invite: (c) => crewInviteLink(c),
      openRoute: (id) => openSharedRoute(id), builds: () => builds, onAllDrives: toDrives, onPlan: (c) => { if (crewEvents) crewEvents.plan(c.id); toDrives(); },
      // the owner's TestFlight note 05: the crew page's Upcoming drives is the crew's drives list, a + plans one (no Crew drives row)
      drives: (c, o) => (crewEvents ? crewEvents.section([{ id: c.id, name: c.name, visibility: c.visibility, role: c.is_owner ? 'owner' : 'member' }], { crewId: c.id, ...o }) : null),
      // P-18: the crew page's drive is the Crew drives sheet's card; a change on one redraws the other
      driveCard: (e, o) => (crewEvents ? crewEvents.card(e, { ...o, redo: () => { o.redo(); crewEvents.refresh(); } }) : null),
      block: safety ? (handle) => safety.block(handle, () => renderAccount()) : null,
      // a crew-mate's sheet: are they a friend ('friend'), did they ask you ('asked'), did you ask them ('sent', kept on this
      // phone as the Invite sheet keeps it), or neither ('none'); null when that can't be read
      friendOf: async (h) => {
        const l = await apiCall('GET', '/api/friends').then(jsonOf).catch(() => null);
        if (!Array.isArray(l)) return null;
        const f = l.find((x) => x && x.handle === h);
        if (f) return f.status === 'accepted' ? 'friend' : f.incoming ? 'asked' : 'sent';
        let sent = []; try { sent = JSON.parse(localStorage.getItem('apex.sentRequests') || '[]'); } catch (_) {}
        return Array.isArray(sent) && sent.includes(h) ? 'sent' : 'none';
      },
      // the same request the Invite sheet sends; when they asked first it makes you friends (social.ts friendRequest)
      addFriend: async (h, accepting) => {
        const r = await apiCall('POST', '/api/friends/request', { handle: h }).catch(() => null);
        if (!r || !r.ok) { toast('Couldn\'t send that. Try again.'); return false; }
        if (!accepting) { try { const l = JSON.parse(localStorage.getItem('apex.sentRequests') || '[]'); localStorage.setItem('apex.sentRequests', JSON.stringify([...(Array.isArray(l) ? l : []).filter((x) => x !== h), h].slice(-30))); } catch (_) {} }
        toast(accepting ? `You and @${h} are friends now.` : `Request sent to @${h}.`);
        return true;
      } }) : null; } catch (e) { console.error('crew page', e); } });
    // Units (web/units.js, IDEAS U-22): every number is formatted when it is drawn, so a change redraws in place (the owner,
    // 2026-10-29: no page reloads). The cluster's unit labels, the loop lengths, the route card and the open sheet are redrawn
    // now; anything else picks the units up the next time it draws. Never mid-drive: the cluster would change under the driver.
    {
      const paintUnits = () => document.querySelectorAll('[data-units]').forEach(b => { const on = b.dataset.units === ApexUnits.system(); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      document.querySelectorAll('[data-units]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.units === ApexUnits.system()) return;
        if (state.mode === 'live') { toast('Change units when the drive has ended.'); return; }
        ApexUnits.set(b.dataset.units); paintUnits(); ApexLogHost.changed('units'); carLook();
        cluster = Inst.mountCluster($('cluster'), look.theme);
        labelLoops(); renderZones();
        if (plannedRoute && !$('routeCard').hidden) { try { renderRouteCard(); } catch (_) {} }
        renderMyData();                                                    // and the offline areas with it
        render(true);
      }));
      paintUnits();
      // driving side (IDEAS U-22): the next route planned uses it
      const paintSide = () => document.querySelectorAll('[data-side]').forEach(b => { const on = b.dataset.side === ApexDrivingSide.choice(); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      document.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => { ApexDrivingSide.setChoice(b.dataset.side); paintSide(); toast('Used from the next route you plan.'); }));
      paintSide();
    }
    // Colour swaps are gone (REVIEW.md roadmap 8): theming is whole themes (Look and voice), not accents. An accent picked
    // before stays off from now on.
    if (Themes.accent && Themes.accent()) { Themes.setAccent(null); applyTheme(); }
    // feature flags (flags.js, IDEAS Y-06): fetched once a start, used from then on
    if (window.ApexFlags && window.ApexSync) ApexFlags.load((p) => ApexSync.apiFetch(p)).catch(() => {});
    // Send feedback (web/feedback.js, IDEAS L-05): Settings → Feedback; the owner reads it in People.
    let accountMe = null, feedbackUi = null;
    onSocial(() => { try {
      feedbackUi = window.ApexFeedback ? ApexFeedback.mount($('feedbackBox'), { el, btn, toast, apiFetch: (...a) => ApexSync.apiFetch(...a), app: ApexSync.inApp ? 'ios' : 'web',
        signedIn: () => !!accountMe,
        env: () => ({ ua: navigator.userAgent, w: screen.width, h: screen.height, lang: navigator.language, page: location.pathname,
                      errors: window.ApexErrors && ApexErrors.reporter ? ApexErrors.reporter.sent : undefined,
                      online: navigator.onLine }) }) : null;
    } catch (e) { console.error('feedback', e); } });
    // Spots near you (web/spots_feed.js, IDEAS S-12): members' shared spots, rated, filtered by kind; Go there plans the way.
    // In Where to? (REVIEW_PEOPLE P-13): a planning input, not a friend thing; drawn the first time it is opened, fresh each time.
    let spotsFeed = null;
    // Crews this month (crew_standings.js, IDEAS S-11/S-08): road data km and smoothness, crew totals only
    let crewStandings = null;
    onSocial(() => { try { crewStandings = window.ApexCrewStandings ? ApexCrewStandings.mount({ el, sync: window.ApexSync, fmtKm: (km) => ApexUnits.long(km * 1000, 0) }) : null; } catch (e) { console.error('crew standings', e); } });
    onSocial(() => { try { spotsFeed = window.ApexSpotsFeed ? ApexSpotsFeed.mount({ el, btn, toast, sync: window.ApexSync, report: safety && safety.report,
      here: () => state.lastPosition || (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })(), goTo: (p) => { closeSheet(); routeToPlace(p); },
      addSpot: () => { showView('garage'); if (window.ApexGarageSettings && ApexGarageSettings.ui) ApexGarageSettings.ui.open('spots'); },
      fmtKm: (km) => ApexUnits.long(km * 1000, 1) }) : null; } catch (e) { console.error('spots', e); } });
    onSocial(() => { if (spotsFeed) {
      const d = $('planSpots'); d.hidden = false;
      d.addEventListener('toggle', () => { if (!d.open) return; const sec = spotsFeed.section(); const h = sec.querySelector(':scope > h3'); if (h) h.remove(); $('planSpotsBody').replaceChildren(sec); });
    } });
    // Time attack (web/time_attack.js, SOCIAL 2.9, IDEAS S-26): this area's loops this season and their boards, in Where to?
    // beside Spots near you; drawn when opened, fresh each time. Runs go up from the Log when stages sync.
    let timeAttack = null;
    const TA_LINE = 'Time attack';   // TestFlight 2026-11-12 (note 7): the row names itself, no tagline
    onSocial(() => { try {
      const ta = window.ApexTimeAttack ? ApexTimeAttack.mount({ el, btn, toast, apiCall, jsonOf, report: safety && safety.report,
        ask: (t, a) => ApexConfirm.ask(t, a),
        here: () => state.lastPosition || (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })(), goTo: (p) => { closeSheet(); routeToPlace(p); },
        segs: () => { try { return JSON.parse(localStorage.getItem('apex.segments') || '[]') || []; } catch (_) { return []; } },
        saveSegs: (l) => { try { localStorage.setItem('apex.segments', JSON.stringify(l)); } catch (_) {} },
        fmtKm: (km) => ApexUnits.long(km * 1000, 1),
        // the week's loop, where nobody in the area has built it yet: our own router's loops (graph_router.js loop) over its tiles
        graphKeys: () => (ownOn() ? ownIndex() : null),
        noteLoop: (x) => { window.apexDebug.lastAttackLoop = x; },   // the e2e reads what the loop drives
        loops: (start, km) => (ownOn() ? ApexOwnRouting.loops(ownRouter(), { start, km, level: LOOP_STYLE, through: true }) : Promise.resolve([])),   // the start on a through road
        // Challenge a friend: a duel on the loop (duels.js challengeOn), won by time unless they pick Score
        challenge: (stage) => { if (duels && duels.challengeOn) { closeSheet(); duels.challengeOn(stage); } },
        // Drive it: the loop itself is the route (as a roadbook road is), not just the way to its start
        driveLoop: (c, g) => driveAttack(c, g),
        // the area's time attacks you've entered (the featured one first), for the car's Places (time_attack.js peek)
        entered: (loops) => { car.attacks = Array.isArray(loops) ? loops : []; carPost(carPlaces()); },
        // the row's own line says this week's loop and your place on it (time_attack.js summaryLine)
        line: (txt) => { const s = $('planAttack').querySelector('summary'); if (s) s.textContent = txt || TA_LINE; } }) : null;
      if (ta) {
        timeAttack = ta;
        const d = $('planAttack'); d.hidden = false;
        if ($('planPanel').classList.contains('open')) peekTimeAttack();   // Where to? already open as signing in finished
        d.addEventListener('toggle', () => { if (!d.open) return; const sec = ta.section(); const h = sec.querySelector(':scope > h3'); if (h) h.remove(); $('planAttackBody').replaceChildren(sec); });
      }
    } catch (e) { console.error('time attack', e); } });
    // Roadbooks (web/roadbooks.js, docs/SOCIAL.md 2.6): collections of great roads, yours, followed and public ones near you;
    // a road you drive is stamped from your own Log. In People (Friends), in Where to?, on a route card's Share, and by link.
    let roadbooks = null;
    onSocial(() => { try { roadbooks = window.ApexRoadbooks ? ApexRoadbooks.mount({ el, btn, toast, apiCall, jsonOf, copyText,
      me: () => accountMe, here: () => state.lastPosition || (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })(), mayLookUp: nearLookupOk,
      cellQuery: (lat, lon) => ApexPrivacyZones.cellQuery(lat, lon), fmtLen: (m) => ApexUnits.long(m, 1, true), origin: () => shareOrigin(),
      zones: () => privacyZones, planned: () => (plannedRoute && Array.isArray(plannedRoute.lat) && plannedRoute.lat.length > 1 ? plannedRoute : null),
      report: (o) => safety && safety.report(o), changed: () => { if (booksRowCount) booksRowCount(); },
      driveRoad: async (road, book) => {
        closeSheet();
        const t = await trackFromPolyline(road.geom, `roadbook_${road.id}`, road.name);
        await buildRoute(null, t.id, road.name, t);
        toast(`${road.name}, from ${book.name}: ${ApexUnits.long(totalM(), 1)}.`);
      },
    }) : null; } catch (e) { console.error('roadbooks', e); } });
    let booksRowCount = null;
    onSocial(() => { if (roadbooks) {
      const d = $('planBooks'); d.hidden = false;
      d.addEventListener('toggle', () => { if (d.open) $('planBooksBody').replaceChildren(roadbooks.nearSection()); });
    } });
    function openRoadbookLink(id) { needSocial().then(() => { if (roadbooks) { closeSheet(); roadbooks.open(id); } }); }
    // Duels (web/duels.js, docs/SOCIAL.md 2.7): a friend against a friend on a stage, the higher Score in the days wins.
    let duels = null;
    onSocial(() => { try { duels = window.ApexDuels ? ApexDuels.mount({ el, btn, toast, apiCall, jsonOf, redo: () => renderAccount(),
      openStage: async (canon, name) => {
        let s = null;
        try { const r = await apiCall('GET', '/api/segments'); const l = r.ok ? await jsonOf(r) : null; s = Array.isArray(l) ? l.find((x) => (x.origin_id || x.id) === canon) : null; } catch (_) {}
        let pts = null;
        try { pts = s ? JSON.parse(s.geom) : null; } catch (_) { pts = null; }
        if (!s) { toast('That stage isn\u2019t in your Stages. Open the duel again once it is.'); return; }
        closeSheet();
        // a stage is kept as [[lat, lon], …]: planned as its own road; one kept as two ends only goes to its start
        if (Array.isArray(pts) && pts.length > 2 && pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
          const t = await trackFromPolyline(pts.map(([la, lo]) => [lo, la]), `stage_${s.id}`, name);
          await buildRoute(null, t.id, name, t);
          toast(`${name}: your duel's stage, ${ApexUnits.long(totalM(), 1)}.`);
        } else routeToPlace({ label: name, lat: s.start_lat, lon: s.start_lon });
      } }) : null; } catch (e) { console.error('duels', e); } });
    // For you (web/inbox.js, docs/SOCIAL.md 2.10): what happened to you socially, newest first, on People → Friends; the
    // People tab's badge counts what is new since you last looked, plus what waits on you. Asked when the social group
    // loads, when the app comes back to the front, and every five minutes while it is in front (never while driving).
    let inbox = null, inboxBadge = null, peopleAsks = [], peopleRequests = 0;
    function paintPeopleBadge() {
      const tab = $('crewTab'), old = tab.querySelector('.badge'); if (old) old.remove();
      // friend requests from For you once it has answered (it may know of a newer one), else from /api/me
      const req = inboxBadge ? inboxBadge.data.items.filter((i) => i.kind === 'request').length : peopleRequests;
      const parts = [[req, 'friend request'], ...peopleAsks, ...(inboxBadge && inboxBadge.n - req > 0 ? [[inboxBadge.n - req, 'new for you']] : [])].filter(([k]) => k > 0);
      const n = parts.reduce((a, [k]) => a + k, 0);
      if (!n) return;
      const b = el('span', { className: 'badge', textContent: String(n) });
      b.setAttribute('aria-label', parts.map(([k, w]) => `${k} ${w}${k === 1 || w === 'new for you' ? '' : 's'}`).join(', '));
      tab.append(b);
    }
    onSocial(() => { try { inbox = window.ApexInbox ? ApexInbox.mount({ el, btn, apiCall, jsonOf,
      signedIn: () => !!(accountMe && accountMe.member),
      onScreen: () => view === 'people' && peopleSide === 'friends' && document.visibilityState === 'visible',
      badge: (n, data) => { inboxBadge = data && Array.isArray(data.items) ? { n, data } : null; paintPeopleBadge(); },
      openStage: (canon, name) => (duels ? duels.openStage(canon, name) : null),
      openBoard: () => { closeSheet(); showView(null); openPlan(true); const d = $('planAttack'); if (d && !d.hidden) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } },
      openBook: (id) => openRoadbookLink(id),
      openCrews: () => setPeopleSide('crews'),
      openPost: (id) => (drivePosts ? drivePosts.open(id) : null) }) : null; } catch (e) { console.error('inbox', e); } });
    // Drive posts and the Feed (web/drive_posts.js, docs/SOCIAL.md 2.13): Post on the drive's card; the Feed on People → Friends
    let drivePosts = null;
    onSocial(() => { try { drivePosts = window.ApexDrivePosts ? ApexDrivePosts.mount({ el, btn, toast, apiCall, jsonOf,
      later: (path, body) => outbox.add(path, body, false, { capped: true }),   // posted with no signal: sent when there is one
      avatar: (id, h, px) => (window.ApexPhotos ? ApexPhotos.avatar(id, h, px) : el('span')),
      fmtLen: (m) => ApexUnits.long(m, 1),
      report: safety && safety.report, block: safety ? (handle) => safety.block(handle, () => renderAccount()) : null,
      crews: () => apiCall('GET', '/api/crews').then(jsonOf).then((l) => (Array.isArray(l) ? l.map((c) => ({ id: c.id, name: c.name })) : [])),
      inZone: (lat, lon) => { try { return !!(window.ApexPrivacyZones && ApexPrivacyZones.zoneAt(ApexPrivacyZones.load(localStorage), lat, lon)); } catch (_) { return false; } },
      myHandle: () => (accountMe && accountMe.handle) || null,
      upload: (path, blob, type) => ApexSync.apiFetch(path, { method: 'PUT', headers: { 'content-type': type }, body: blob }),
      // the real map under each post's line (post_map.js), in the theme's palette; never while a drive is on
      mapUnder: (() => { let snap = null; return (id, pts, w, h, pad) => {
        if (driveActive || !window.ApexPostMap || !window.maplibregl || !window.ApexBasemap) return null;
        snap = snap || ApexPostMap.snapper({ gl: maplibregl, style: MAP_STYLE, palette: () => look.map, restyle: ApexBasemap.restyle,
          transform: window.ApexOfflineTiles ? ApexOfflineTiles.transform : undefined });
        return snap.snap(`${look.map.bg}|${look.map.road}|${id}`, pts, w, h, pad); }; })(),
      openFriend: (h) => { document.querySelectorAll('.feed-sheet').forEach((n) => n.remove()); if (window.apexOpenFriend) window.apexOpenFriend(String(h).toLowerCase()); },
      // Drive it on a post: a route through stops along its line, on real roads (the line is thinned, so it is not driven as drawn)
      driveLine: async (stops, p) => {
        if (!Array.isArray(stops) || stops.length < 2) return;
        closeSheet(); showView(null);
        const name = String(p.title || 'A friend\u2019s drive').slice(0, 60);
        await buildRoute(stops, `post_${p.id}`, name);
        if (plannedRoute && plannedRoute.id === `post_${p.id}`) toast(`${name}${p.mine ? '' : `, @${p.handle}'s line`}: ${ApexUnits.long(totalM(), 1)}.`);
      } }) : null; } catch (e) { console.error('drive posts', e); } });
    const inboxTick = () => { if (inbox && !driveActive && document.visibilityState === 'visible') inbox.refresh(); };
    document.addEventListener('visibilitychange', inboxTick);
    setInterval(inboxTick, 5 * 60 * 1000);
    let garage = null;
    // Build threads (web/builds.js, REVIEW.md 5.3): from a car card, the crew page and Builds you follow.
    let builds = null;
    onSocial(() => { try { builds = window.ApexBuilds ? ApexBuilds.mount({ el, btn, toast, apiCall, jsonOf, report: safety && safety.report }) : null; } catch (e) { console.error('builds', e); } });
    // Meets on the map (web/meets_map.js, IDEAS S-13): public crews' listed drives pinned at their meeting points; a tap
    // is the same card as Crew → Meets near you. Off by default, members only, asked by the map centre's cell.
    let meetsMap = null;
    onSocial(() => { try { meetsMap = window.ApexMeetsMap && crewEvents && crewEvents.meetCard ? ApexMeetsMap.mount({ el, btn, apiCall, jsonOf, map,
      mapCentre: () => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; }, mayLookUp: nearLookupOk,
      card: (e, redo) => crewEvents.meetCard(e, redo) }) : null; } catch (e) { console.error('meets map', e); } });
    // Friends on the map (web/friends_map.js, REVIEW.md 5.4): the Friends layer and who sees you, sent only while you drive
    let friendsMap = null;
    onSocial(() => { try { friendsMap = window.ApexFriendsMap ? ApexFriendsMap.mount({ el, btn, toast, askSignIn, apiCall, map, zones: () => privacyZones, inZone: inPrivacyZone,
      position: () => state.lastPosition || null, driving: () => driveActive,
      roadName: (lat, lon) => { try { return window.ApexRoadNames ? ApexRoadNames.nearestRoadName(map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name' }), lat, lon) : null; } catch (_) { return null; } },
      setLayerToggle: (on) => { state.toggles.friends = on; paintSwitches(); friendsMap.setLayer(on); savePrefs(); }, openGarage: () => showView('garage') }) : null; } catch (e) { console.error('friends map', e); } });
    // Who sees what (web/who_sees.js, REVIEW_PEOPLE P-09): every "what people see of you" control on one page, in the Garage
    // under You; People's You row, a friend's "What @x sees of you" and Layers' Who sees me all open it (P-19: one room).
    let whoSees = null, roadFeelOn = null;
    onSocial(() => { try { whoSees = window.ApexWhoSees && friendsMap ? ApexWhoSees.mount({ el, btn, toast, apiCall, jsonOf, friendsMap, zones: () => privacyZones,
      crews: () => (window.ApexSync && ApexSync.crews ? ApexSync.crews() : apiCall('GET', '/api/crews').then(jsonOf)),
      roadFeel: { get: () => roadFeelOn, set: async (on) => { const r = await apiCall('PUT', '/api/me/contribute', { on }).catch(() => null); if (r && r.ok) { roadFeelOn = !!on; if (!on) clearCarry(); } return !!(r && r.ok); } },
      openGarage: (what) => { showView('garage'); const t = what === 'privacy' ? $('zoneRadius') : $('garageMeBody'); if (t && window.ApexGarageSettings && ApexGarageSettings.ui && ApexGarageSettings.ui.reveal(t)) return; if (t) setTimeout(() => t.scrollIntoView({ block: 'start' }), 60); },
      onChange: () => { if (view === 'people' || view === 'garage') renderAccount(); } }) : null; } catch (e) { console.error('who sees', e); } });
    onSocial(() => { if (friendsMap) $('friendsSheetBtn').addEventListener('click', () => (whoSees && accountMe && accountMe.member ? whoSees.open() : friendsMap.sheet())); });
    onSocial(() => { try { garage = window.ApexGarageUI ? ApexGarageUI.mount({ el, btn, toast, apiCall, jsonOf, report: safety && safety.report, onCars: setRoutingCars, onPhotos: () => renderAccount(), builds }) : null; } catch (e) { console.error('garage', e); } });
    // an on/off setting is the slide switch (U-44), the label beside it, never a key that reads "Off"
    const switchRow = (label, on, change) => { const b = el('button', { className: 'sw' + (on ? ' on' : ''), onclick: change }, el('i'), el('span', { textContent: label })); b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!!on)); return b; };
    // ?friend=bob (a friend's handle on the Log's Friends lately): People opens on that friend's profile once the list is drawn
    let openFriendHandle = (() => { const h = String(params.get('friend') || '').replace(/^@/, '').toLowerCase(); return /^[a-z0-9_]{3,20}$/.test(h) ? h : null; })();
    window.apexOpenFriend = (h) => { openFriendHandle = h; renderAccount(); };   // the Log frame's link, through ApexLogHost.load: People is drawn again, on them
    let openCrewId = null, openFriendId = null, crewOpen = null;   // crewOpen: the crew open over the crews dashboard (this visit)   // the crew tile and the friend row left open across a redraw
    const crewNear = () => { if (state.lastPosition) return state.lastPosition; const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; };
    // Links people share open the website (in the app the page's own origin is apexnav://app, which no one else can open).
    const shareOrigin = () => ApexSync.siteBase;   // vettadrive.app (sync.js SITE_BASE)
    const crewPreview = { token: null, data: null };   // what the crew link is for, fetched once per link
    let renderGen = 0;   // two renders at once (a link while one runs): only the newest one draws
    // The no-connection page (renderAccount) follows the phone: it asks again by itself when the connection is back, and
    // says "offline" when it goes; nobody should have to press Try again to find out the signal returned.
    for (const ev of ['online', 'offline']) window.addEventListener(ev, () => { if (document.querySelector('.lost-page')) renderAccount(); });
    async function renderAccount() {
      // People (the owner, 2026-10-30): the Friends side (accountBody) and the Crews side (crewsBody), one switch between them
      const body = $('accountBody'), cbody = $('crewsBody'), gen = ++renderGen;
      let me = null;
      accountMe = null;
      try { const r = await apiCall('GET', '/api/me'); if (r.ok && (r.headers.get('content-type') || '').includes('json')) me = await r.json(); } catch (_) {}
      if (gen !== renderGen) return;
      try { applyThemeGrants(me); } catch (e) { console.error('theme grants', e); }   // the account's private themes, or none
      try { applyDevFlags(me); } catch (e) { console.error('dev flags', e); }          // developer tools (Satellite), or none
      // F-03: People and the Garage are never drawn without their modules while they are open; once loaded, needSocial draws them
      if (!socialIn && !socialFailed && (view === 'people' || view === 'garage')) { needSocial(); return; }
      accountMe = me && me.signed_in ? me : null;
      syncItems(false);                                                     // saved routes and pinned places from the account
      if ($('myAccountDelGo')) $('myAccountDelGo').hidden = !accountMe;   // Your data's way to Delete account, signed in only
      if (accountMe && accountMe.member) loadCrewHazardKinds();
      // push on: this launch's token to the Worker (it can change), asked of the shell once a page load
      if (accountMe && accountMe.member && state.toggles.push && !window.apexPushAsked && pushShell()) { window.apexPushAsked = true; try { pushShell().postMessage({ cmd: 'push', op: 'token' }); } catch (_) {} }
      paintPushState();
      // Where to? opened before the account came back: its time attack row's peek skipped then, so it goes now (CI 2026-11-12)
      if (accountMe && accountMe.member && $('planPanel').classList.contains('open')) peekTimeAttack();
      if (friendsMap && accountMe && accountMe.member) { friendsMap.start(); if (state.toggles.friends) friendsMap.setLayer(true); }
      else if (state.toggles.friends) { state.toggles.friends = false; paintSwitches(); }
      if (meetsMap && accountMe && accountMe.member) { if (state.toggles.meets) meetsMap.setLayer(true); }
      else if (state.toggles.meets && socialIn) { state.toggles.meets = false; paintSwitches(); }
      if (feedbackUi) feedbackUi.refresh();
      if (me && !me.signed_in) setRoutingCars(null);
      else if (me && me.member) apiCall('GET', '/api/garage').then(r => (r.ok ? r.json() : null)).then(list => { if (list) setRoutingCars(list); }).catch(() => {});
      body.innerHTML = ''; cbody.innerHTML = '';
      const gbody = $('garageMeBody'); gbody.innerHTML = '';
      // REVIEW5 §2: road feel and the account live behind the Garage's gear (web/garage_settings.js), drawn here as before
      const rfBody = $('garageRoadFeelBody') || gbody, accBody = $('garageAccountBody') || gbody;
      if (rfBody !== gbody) rfBody.innerHTML = ''; if (accBody !== gbody) accBody.innerHTML = '';
      const redo = () => renderAccount();
      peopleAsks = []; peopleRequests = 0;
      if (!(accountMe && accountMe.member)) inboxBadge = null;               // signed out or not a member: no For you count
      if (inbox) inbox.refresh();
      paintPeopleBadge();
      const params2 = new URLSearchParams(location.search);
      // The People pages' parts (signed out, and no connection): what a side gets you as rows shaped like its list, and its drawing.
      const gets = (...items) => el('ul', { className: 'join-gets' }, ...items.map(([path, label, what]) => el('li', {},
        el('span', { className: 'jg-glyph', innerHTML: `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>` }), el('b', { textContent: label }), el('small', { textContent: what }))));
      // A road drawn as a printed map draws one (ink casing, paper fill), the people on it as pucks; the red one is the logo's dot.
      const roads = (...ds) => ds.map((d) => `<path class="jr-case" d="${d}"/>`).join('') + ds.map((d) => `<path class="jr-fill" d="${d}"/>`).join('');   // casings first: roads that meet, join
      const pucks = (...at) => at.map(([x, y, lead]) => `<circle class="jr-puck${lead ? ' lead' : ''}" cx="${x}" cy="${y}" r="7"/>`).join('');
      const drawing = (inner) => el('div', { className: 'join-art', innerHTML: `<svg viewBox="0 0 360 128" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${inner}</svg>` });
      if (!me) {
        // No answer from the server is a page too (design pass 5, 2026-11-10; it was a heading, a grey line and a key at the
        // top of an empty sheet): the road stops where the signal does, you are still on it, and what works without a
        // connection is listed as the rows that will come back. It says which it is: the phone is offline, or Vetta didn't answer.
        const offline = navigator.onLine === false;
        const again = (cls = 'ink-btn solid') => { const b = btn('Try again', () => { b.disabled = true; b.textContent = 'Trying…'; redo(); }, cls); return b; };
        const works = () => gets(['<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M8.5 11l3.5-3.5 3.5 3.5"/>', 'Driving and notes', 'Navigation and the notes for the road ahead.'],
          ['<path d="M5 6h14M5 12h14M5 18h9"/>', 'Your Log', 'Every drive you recorded is on this phone.'],
          ['<path d="M7 4h10v16l-5-4-5 4z"/>', 'Saved routes', 'Routes you saved for offline, in Where to?']);
        const lost = (side) => el('div', { className: 'join-page lost-page' },
          drawing(roads('M-12 88 C 50 88 78 40 146 44 S 196 70 214 66') + '<path class="jr-ghost" d="M214 66 C 262 54 300 30 372 46"/>' + pucks([214, 66, true])),
          el('h3', { className: 'join-head', textContent: offline ? 'You’re offline.' : 'Can’t reach Vetta.' }),
          el('p', { className: 'join-line', textContent: offline ? `${side} need a connection. These don’t:` : `${side} will be back when it answers. These don’t need it:` }),
          works(), el('div', { className: 'join-sign' }, again()));
        body.append(lost('Friends and who’s out driving'));
        cbody.append(lost('Crews, their drives and boards'));
        // the Garage's own corner said nothing (an empty band over Look and voice): it says what is missing and what isn't
        gbody.append(el('h3', { textContent: 'Your cars' }), el('p', { className: 'note', textContent: `${offline ? 'Your cars and profile need a connection.' : 'Your cars and profile will be back when Vetta answers.'} Looks, voices and settings work without it.` }), again('ink-btn'));
        return;
      }
      const inviteFromLink = params2.get('invite'), crewFromLink = params2.get('crew'), addFromLink = params2.get('add');
      let stashed = false;
      try { if (inviteFromLink) sessionStorage.setItem('apex.invite', inviteFromLink); if (crewFromLink) sessionStorage.setItem('apex.crew', crewFromLink); if (addFromLink) sessionStorage.setItem('apex.add', addFromLink.toLowerCase()); stashed = true; } catch (_) {}
      // Kept in the tab, gone from the address bar: a reload or a redraw must not act on the link again.
      if (inviteFromLink || crewFromLink || addFromLink) {
        if (stashed) try { for (const k of ['invite', 'crew', 'add']) params2.delete(k); history.replaceState(history.state, '', location.pathname + (params2.toString() ? '?' + params2 : '') + location.hash); } catch (_) {}
        showView(crewFromLink ? 'crews' : 'friends');   // each link opens the side it belongs to
      }
      // Terms and Privacy open in Safari from the app (http links leave the web view, #135) and in a new tab on the web.
      const legalLink = (path, text) => el('a', { href: `${LEGAL_SITE}/${path}`, target: '_blank', rel: 'noopener', textContent: text });
      const legalNote = (lead) => el('p', { className: 'note' }, lead, legalLink('terms.html', 'Terms'), ' and ', legalLink('privacy.html', 'Privacy'), ' policy.');
      const stash = (k) => { try { return sessionStorage.getItem(k) || ''; } catch (_) { return ''; } };
      const unstash = (k) => { try { sessionStorage.removeItem(k); } catch (_) {} };
      // A step only the Friends side can take (joining, a handle): the Crews side says so and has the key across.
      const acrossToFriends = (title, text, key) => [el('h3', { textContent: title }), el('p', { className: 'note', textContent: text }), btn(key, () => setPeopleSide('friends'), 'ink-btn solid')];
      if (!me.signed_in) {
        // Signed out is a page, not a form (the owner, 2026-11-10): a drawing of the side, its name set large, what it gets you as
        // three rows shaped like the list that will stand here, and the sign-in at the foot, under the thumb (REVIEW.md 1.2, P-32).
        const signIn = () => el('div', { className: 'join-sign' }, appleButton(),
          el('a', { className: 'ink-btn solid', href: '/api/auth/google/start', textContent: 'Sign in with Google' }),
          legalNote('By signing in you agree to the '));
        const page = (art, head, line, list, waiting) => el('div', { className: 'join-page' }, drawing(art), el('h3', { className: 'join-head', textContent: head }),
          el('p', { className: 'join-line', textContent: line }), list, ...(waiting ? [el('p', { className: 'join-wait', textContent: waiting })] : []), signIn());
        // P-02: anyone who signs in is in; a link waiting here says what signing in will do with it
        const waiting = stash('apex.invite') ? 'You have a friend link. Sign in and you’re friends.' : stash('apex.add') ? `Sign in to ask @${stash('apex.add')} to be your friend.` : '';
        const crewDrives = ['<rect x="3" y="5" width="18" height="15"/><path d="M3 10h18M8 3v4M16 3v4"/>', 'Crew drives', 'A time, a meeting point and who’s going.'];
        // Friends: two roads that meet, someone on each. P-32: what a newcomer with no friends yet can look forward to, not the board.
        body.append(page(roads('M-12 34 C 70 34 96 96 176 92 S 300 24 372 50', 'M92 140 C 108 112 148 98 176 92') + pucks([116, 115], [277, 60, true]),
          'Drive with friends.', 'Friends see your Scores and times. Switch it off for anyone.',
          gets(['<path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>', 'Who’s out driving', 'On your map, on the road they’re driving, when they share it.'],
            crewDrives,
            ['<path d="M6 20c0-5 12-3 12-9 0-3-3-4-6-6"/><circle cx="6" cy="20" r="1.4"/><circle cx="12" cy="5" r="1.4"/>', 'Shared routes', 'A route you planned, sent to a friend to drive.']), waiting));
        // Crews: one road, three in file behind the lead.
        cbody.append(page(roads('M-12 96 C 60 96 84 36 156 36 S 262 98 372 70') + pucks([72, 66], [98, 50], [128, 39], [173, 37, true]),
          'Drive as a crew.', 'A group for a club or a weekend run.',
          gets(['<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/>', 'Your crew’s page', 'Its crest, its next drive, its board and its chat.'],
            crewDrives,
            ['<path d="M8 21l3-18M16 21l-3-18"/><circle cx="12" cy="16" r="1.6"/><circle cx="12" cy="9" r="1.6"/>', 'Convoys', 'Everyone on one map while you drive together.']),
          stash('apex.crew') ? 'You have a crew link. Sign in to see which crew, then join it.' : ''));
        // An empty bay, not a paragraph (design pass, 2026-11-10): the place a car will stand, drawn in pencil, and the key that gets you there.
        gbody.append(el('h3', { textContent: 'Your cars' }), el('div', { className: 'empty-bay' },
          el('span', { className: 'eb-slot', innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16v-3l2.2-5h13.6L21 13v3M3 16h18M3 16v2M21 16v2"/><circle cx="7.5" cy="13" r="1"/><circle cx="16.5" cy="13" r="1"/></svg>' }),
          el('p', {}, el('b', { textContent: 'No car parked here yet' }), el('small', { textContent: 'Sign in to keep your cars and build threads.' })),
          btn('Sign in', () => showView('friends'), 'ink-btn')));
        ambientFromAccount(false, false);                                     // U-116
        return;
      }
      // Anyone signed in can take their data or close the account, member or not.
      const downloadMyData = async () => { const r = await apiCall('GET', '/api/me/export'); const blob = new Blob([JSON.stringify(await r.json(), null, 2)], { type: 'application/json' }); const a = el('a', { href: URL.createObjectURL(blob), download: 'vetta-my-data.json' }); a.click(); };
      const deleteMyAccount = async () => { if (await ApexConfirm.prompt('This erases your account, friends, shared results and spots from the server. Type DELETE to confirm.', { action: 'Delete account', placeholder: 'DELETE', maxLength: 10, match: 'DELETE' }) === 'DELETE') { const r = await apiCall('DELETE', '/api/me', { confirm: 'DELETE' }); if (r.ok) { ApexSync.setSession(null); clearCarry(); clearCrowd(); } redo(); } };
      // Vetta is open (P-02, the owner 2026-10-30): everyone signed in is a member, so the only one who isn't is an account the owner
      // removed. No paste field and no way in to offer; one line on each side, and the account's keys in the Garage, where they live (P-22).
      if (!me.member) {
        for (const b of [body, cbody]) b.append(el('h3', { textContent: 'Friends and crews are closed to this account' }),
          el('p', { className: 'note', textContent: 'Driving, notes and your Log work as always. Your account is still yours: download or delete it in the Garage.' }));
        const asec = el('div', { className: 'stack-8' });                        // the sheet's head says Account
        asec.append(el('div', { className: 'row' }, btn('Download my data', downloadMyData),
          btn('Sign out', async () => { await pushForgetHere(); await apiCall('POST', '/api/auth/logout'); ApexSync.setSession(null); clearCarry(); clearCrowd(); redo(); })), btn('Delete account', deleteMyAccount, 'danger-btn'));
        accBody.append(asec);
        return;
      }
      if (!me.handle) {
        const pickHandle = () => el('input', { className: 'field', placeholder: 'Pick a handle', autocomplete: 'off', autocapitalize: 'none', 'aria-label': 'Handle' });
        const saveHandle = async (inp) => { const r = await apiCall('PUT', '/api/me/handle', { handle: inp.value }); if (!r.ok) toast(r.status === 409 ? 'That handle is taken.' : 'Use 3 to 20 letters, numbers or _.'); return r.ok; };
        const inp = pickHandle();
        body.append(el('h3', { textContent: 'Pick a handle' }), el('p', { className: 'note', textContent: stash('apex.invite') ? 'Friends find you by it. Then you’re friends with whoever sent your link.' : 'Friends find you by it. 3 to 20 letters, numbers or _.' }),
          el('div', { className: 'row' }, inp, btn('Save', async () => { if (await saveHandle(inp)) redo(); }, 'ink-btn solid')));
        // P-02: one link is the whole way in. Someone who opened a crew link and just signed in sees the crew and joins it here,
        // the handle (how the crew sees them) picked in the same card; never "join Vetta first".
        const tok = stash('apex.crew');
        if (tok) {
          const what = el('p', { textContent: 'You have a crew link.' }), hin = pickHandle();
          const why = el('p', { className: 'note', textContent: 'Pick a handle: it’s how the crew sees you.' });
          apiCall('POST', '/api/crews/invite/preview', { token: tok }).then((r) => (r.ok ? jsonOf(r) : null)).then((j) => {
            if (gen !== renderGen || !j || !j.name) return;
            what.replaceChildren(document.createTextNode('Join '), el('b', { textContent: j.name }), document.createTextNode('?'));
            why.textContent = `${j.members} ${j.members === 1 ? 'member' : 'members'}${j.from ? ` · @${j.from} sent you the link, and you’ll be friends` : ''}.`;   // the field says Pick a handle
          }).catch(() => {});
          cbody.append(el('div', { className: 'card stack-8' }, what, why, el('div', { className: 'row' }, hin, btn('Join crew', async (e) => {
            const b = e && e.currentTarget; if (b) { if (b.disabled) return; b.disabled = true; }
            try {
              if (!(await saveHandle(hin))) return;
              const r = await apiCall('POST', '/api/crews/join', { token: tok }), j = r.ok ? await jsonOf(r) : null;
              if (r.ok || (r.status >= 400 && r.status < 500)) unstash('apex.crew');
              toast(r.ok ? (j && j.friend ? `You're in the crew, and friends with @${j.friend}.` : 'You joined the crew.') : r.status < 500 ? 'That crew link didn\'t work. Ask for a new one.' : 'Couldn\'t join. Check signal and try again.');
              if (j && j.public) await askPublicSharing(j.id, 'this crew');
              redo();
            } catch (_) { toast('Couldn\'t join. Check signal and try again.'); } finally { if (b) b.disabled = false; }
          }, 'ink-btn solid')), btn('Not now', () => { unstash('apex.crew'); redo(); }, 'linkbtn')));
        } else cbody.append(...acrossToFriends('Crews', 'Pick a handle first: it’s how your crew sees you.', 'Pick a handle'));
        return;
      }
      const sharedP = apiCall('GET', '/api/routes/shared').then(jsonOf).catch(() => null);
      const [fr, gr, pts, crews, live, convoyAsks] = await Promise.all([apiCall('GET', '/api/friends').then(jsonOf), apiCall('GET', '/api/grants').then(jsonOf), apiCall('GET', '/api/points').then(jsonOf),
        window.ApexSync && ApexSync.crews ? ApexSync.crews() : apiCall('GET', '/api/crews').then(jsonOf),
        friendsMap ? friendsMap.sharing().catch(() => null) : null,
        convoy && !convoy.active ? apiCall('GET', '/api/convoy/invites').then(jsonOf).catch(() => null) : null]);
      if (gen !== renderGen) return;
      // P-34: the badge counts friend requests (For you's count once it has answered), a crew link not yet answered, convoy invites, and what's new (inbox.js)
      peopleRequests = me.requests || 0;
      peopleAsks = [[stash('apex.crew') ? 1 : 0, 'crew invite'], [Array.isArray(convoyAsks) ? convoyAsks.length : 0, 'convoy invite']].filter(([n]) => n > 0);
      paintPeopleBadge();
      roadFeelOn = me && me.member ? !!me.contribute : null;   // /api/me says it: no need for the whole export
      const friends = Array.isArray(fr) ? fr : [], grants = new Map((Array.isArray(gr) ? gr : []).map(g => [g.audience_type + ':' + g.audience_id, g]));
      const putGrant = async (type, id, scores, times) => { await apiCall('PUT', '/api/grants', { audience_type: type, audience_id: id, share_scores: scores, share_times: times }); redo(); };

      // you (in the Garage: REVIEW.md 3.2, your own identity lives with your cars)
      const you = section('You');
      // your profile photo (REVIEW.md 5.2): a round face beside your handle, or your initial until you add one
      // TestFlight 2026-11-05: the photo itself is the key, as in every other app: a tap adds one, or changes or removes it
      // on a small sheet; no separate keys and no note (the toast after an upload says its location data stayed on the phone)
      const face = window.ApexPhotos ? ApexPhotos.avatar(me.photo_id, me.handle, 72) : null;
      const faceKey = face && me.member && ApexPhotos.mine ? ApexPhotos.mine(face, me.photo_id, 'profile', redo, { toast, name: 'your profile photo' }) : face;
      you.append(el('div', { className: 'row', style: 'align-items:center;gap:12px' }, ...(faceKey ? [faceKey] : []), el('b', { textContent: `@${me.handle}`, style: 'font-size:22px;font-family:var(--font-num)' })));   // no "points": a number with no unit (REVIEW2.md U-41)
      // Who sees what (P-09): under You, every audience and what it gets
      if (whoSees) you.append(el('div', { className: 'nav-rows' }, whoSees.row()));
      // your drive posts, as your friends see them on your profile (docs/SOCIAL.md 2.13), with kudos, comments and Delete
      gbody.append(you);
      if (drivePosts && drivePosts.drivesOf && me.member && me.id) gbody.append(drivePosts.drivesOf(me.id));
      // Lists one tap away open as side sheets over People (REVIEW2.md U-30): each a row with its count and a chevron.
      const popSheet = (title) => { const p = el('aside', { className: 'side-pop people-pop' }); p.setAttribute('aria-label', title);
        p.append(el('div', { className: 'side-pop-head' }, el('h3', { textContent: title }), btn('Done', () => p.classList.remove('open'), 'linkbtn'))); return p; };
      const pops = [];
      const rowKey = (label, open) => { const count = el('small'), b = el('button', { className: 'nav-row', type: 'button' }, el('span', { textContent: label }), count, el('i', { 'aria-hidden': 'true' }));
        b.addEventListener('click', open); b._count = count; return b; };
      const navRow = (label, content) => { const pop = popSheet(label); pop.append(content); pops.push(pop);
        const h = content.querySelector(':scope > h3'); if (h && h.textContent === label) h.remove();   // the pop's head names it once
        const b = rowKey(label, () => pop.classList.add('open')); b._pop = pop; return b; };

      // ---- Friends (REVIEW_PEOPLE step 5/6): a request waiting, you, your friends, one Invite key, then what friends shared ----
      // Requests you sent live on this phone (the server doesn't list them, so a reply never tells which handles exist; IDEAS Z-12).
      const SENT_KEY = 'apex.sentRequests';
      const sentList = () => { try { return JSON.parse(localStorage.getItem(SENT_KEY) || '[]').filter(h => typeof h === 'string'); } catch (_) { return []; } };
      const setSent = (l) => { try { localStorage.setItem(SENT_KEY, JSON.stringify(l.slice(-30))); } catch (_) {} };
      const accepted = friends.filter(f => f.status === 'accepted'), incoming = friends.filter(f => f.status === 'pending' && f.incoming);
      setSent(sentList().filter(h => !friends.some(f => f.handle === h)));   // accepted, or they asked you too: no longer "sent"
      const waiting = sentList();
      // Where each friend is, from what they share with you (friends_map.js friendState): on the road or last seen; nothing shared, no line.
      // The positions couldn't be read: no line, rather than "not sharing" said of everyone.
      const where = new Map((Array.isArray(live) ? live : []).map((p) => [p.handle, p]));
      const stateOf = (f) => (Array.isArray(live) && window.ApexFriendsMap ? ApexFriendsMap.friendState(where.get(f.handle)) : null);
      const seenAt = (f) => { const p = where.get(f.handle), t = p ? Date.parse(p.at) : NaN; return Number.isFinite(t) ? t : -Infinity; };
      const order = accepted.map((f) => ({ f, st: stateOf(f) })).sort((a, b) => (b.st && b.st.live) - (a.st && a.st.live) || (seenAt(b.f) - seenAt(a.f) || 0));
      const sharedList = await sharedP;
      if (gen !== renderGen) return;
      const shared = Array.isArray(sharedList) ? sharedList : [];

      // P-05: a request in is a card at the top of the list until it is answered (the ask is in the list, not in a drawer)
      for (const f of incoming) body.append(el('div', { className: 'card request-card' },
        el('p', {}, el('b', { textContent: `@${f.handle || '?'}` }), document.createTextNode(' wants to be your friend'), ...(f.name ? [el('small', { textContent: f.name })] : [])),
        el('div', { className: 'row' },
          btn('Accept', async () => { await apiCall('POST', '/api/friends/accept', { user_id: f.id }); toast(`You and @${f.handle} are friends.`); redo(); }, 'ink-btn solid'),
          btn('Not now', async () => { await apiCall('DELETE', `/api/friends/${f.id}`); toast(`Declined. @${f.handle} isn’t told.`); redo(); }, 'linkbtn'))));

      // Duels (duels.js): one asked of you, one on, a result: cards under the requests, while there is a friend to duel
      if (duels && accepted.length) body.append(duels.cards());

      // P-23: you, one tap from People: your face, your handle and who sees where you are; it opens Who sees what (P-09)
      const WHO = { nobody: 'Nobody sees where you are', crew: 'Your private crews see where you are', friends: 'Friends see where you are' };
      const empty = !accepted.length && !(Array.isArray(crews) && crews.length);
      // For you (inbox.js): what happened to you lately, one sentence a row (a new account's page stays its three parts)
      if (inbox && !empty) body.append(inbox.section());
      // the Feed (drive_posts.js): the newest drives your friends and crews posted, kudos and comments one tap in
      if (drivePosts && !empty) {
        const fpop = popSheet('Feed'); pops.push(fpop);
        body.append(drivePosts.section(() => { if (!fpop._filled) { fpop.append(drivePosts.full()); fpop._filled = true; } fpop.classList.add('open'); }));
      }
      if (!empty) {
        const yline = el('small'), yface = window.ApexPhotos ? ApexPhotos.avatar(me.photo_id, me.handle, 40) : el('span');
        const yrow = el('button', { className: 'friend-head you-row', type: 'button', 'aria-label': `You, @${me.handle}: who sees what` }, yface,
          el('span', { className: 'friend-who' }, el('b', { textContent: `You · @${me.handle}` }), yline), el('i', { className: 'chev', 'aria-hidden': 'true' }));
        yrow.addEventListener('click', () => (whoSees ? whoSees.open() : showView('garage')));
        const paintYou = () => { yline.textContent = friendsMap && friendsMap.loaded ? WHO[friendsMap.settings.audience] || '' : ''; };
        if (friendsMap && !friendsMap.loaded) friendsMap.loadSettings().then(paintYou).catch(() => {}); else paintYou();
        body.append(yrow);
      }

      // A friend's profile (profile_view.js, IDEAS S-15): a sheet over the list; its back key returns to it.
      const ppop = el('aside', { className: 'side-pop people-pop' }); ppop.setAttribute('aria-label', 'Friend'); pops.push(ppop);
      // P-04: what you do with a friend, on their row and on their profile
      const closeProfile = () => { ppop.classList.remove('open'); openFriendId = null; };
      const seeOnMap = (f) => {
        const p = where.get(f.handle); if (!p || !friendsMap) return;
        showView(null); closeProfile();
        if (!state.toggles.friends) { state.toggles.friends = true; paintSwitches(); savePrefs(); }
        friendsMap.setLayer(true);
        if (mapReady) map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 11), duration: 900 });
      };
      const driveWith = async (f) => {
        if (!convoy) return;
        if (convoy.active) { toast(`You're in a convoy: invite @${f.handle} from its Invite friends.`); return; }
        if (!(await ApexConfirm.ask(`Start a convoy with @${f.handle}? You see each other on the map for two hours. Nothing is kept.`, 'Start convoy'))) return;
        const r = await convoy.startFor(`@${me.handle} and @${f.handle}`, [f.handle]);
        toast(r.ok ? (r.invited ? `Convoy started. @${f.handle} has the invite in the app.` : `Convoy started, but @${f.handle} couldn't be invited. Share its link.`) : 'Couldn\'t start a convoy. Check signal.');
        if (r.ok) closeSheet();
      };
      const keysFor = (f) => [
        ...(where.get(f.handle) && friendsMap ? [['On the map', () => seeOnMap(f)]] : []),
        ['Share a route', () => { closeProfile(); shareRouteWith(f.handle); }],
        ...(convoy ? [['Invite to a drive', () => driveWith(f)]] : []),
        ...(duels ? [['Challenge on a stage', () => duels.challenge(f)]] : [])];
      // Nate 2026-11-12 (as easy as a big social app): a tap on a friend opens their profile; what you do with them, their last
      // share and what they see of you are on it (the row used to open five keys, a share and a grants drawer in the list)
      const aboutYou = (f) => {
        const g = grants.get('friend:' + f.id) || { share_scores: 0, share_times: 0 };
        const k = el('button', { className: 'nav-row quiet friend-sees', type: 'button' }, el('span', { textContent: `What @${f.handle} sees of you` }),
          el('small', { textContent: g.share_scores ? (g.share_times ? 'Scores, times' : 'Scores') : 'Nothing' }), el('i', { 'aria-hidden': 'true' }));
        k.addEventListener('click', () => (whoSees ? whoSees.open({ friend: f.id }) : showView('garage')));
        return k;
      };
      const lastShare = (f) => {
        const last = shared.find((r) => r.from_handle && r.from_handle === f.handle);
        return last ? [el('div', { className: 'row friend-last', style: 'align-items:center' }, el('p', { className: 'note', style: 'flex:1;margin:0', textContent: `Shared ${last.name}${sharedWhen(last.created_at) ? ` · ${sharedWhen(last.created_at)}` : ''}` }),
          btn('Open', () => { closeProfile(); openSharedRoute(last.id); }, 'linkbtn'))] : [];
      };
      const openProfile = async (f) => {
        openFriendId = f.id;   // a redraw of People (a grant changed, presence came in) opens it again
        let p = null;
        try { const r = await apiCall('GET', `/api/friends/${encodeURIComponent(f.id)}/profile`); p = r.ok ? await jsonOf(r) : null; } catch (_) {}
        const view = el('div', { className: 'stack-8 profile-view' });
        // P-04: Unfriend, Report and Block live at the profile's foot, not on the row
        const st = stateOf(f), photo = (where.get(f.handle) || {}).photo_id || null;
        ApexProfileView.show(view, p && !Array.isArray(p) ? p : { handle: f.handle, name: f.name }, { el, btn, back: () => closeProfile(), keys: keysFor(f),
          avatar: window.ApexPhotos ? ApexPhotos.avatar(photo, f.handle || '?', 56) : null, status: st && st.text ? { text: st.text, live: !!st.live } : null,
          partial: !p || Array.isArray(p), extra: [...lastShare(f), ...(drivePosts && drivePosts.drivesOf ? [drivePosts.drivesOf(f.id)] : []), aboutYou(f)],
          foot: [['Unfriend', async () => { if (await ApexConfirm.ask(`Unfriend @${f.handle}? This also stops all sharing.`, 'Unfriend')) { await apiCall('DELETE', `/api/friends/${f.id}`); closeProfile(); redo(); } }, 'danger-btn'],
            ...(safety && f.handle ? [['Report', () => safety.report({ kind: 'user', target: f.handle, label: `@${f.handle}`, who: f.handle, done: redo })],
                                     ['Block', () => safety.block(f.handle, () => { closeProfile(); redo(); })]] : [])] });
        ppop.replaceChildren(view); ppop.classList.add('open');
      };
      // P-02: a friend link (?invite=) is "add a friend" now, not a way in. It asks first, naming who sent it, at the top of the list.
      const friendTok = stash('apex.invite');
      if (friendTok) {
        const what = el('p', { textContent: 'You have a friend link.' }), actions = el('div', { className: 'row' });
        apiCall('POST', '/api/invites/preview', { token: friendTok }).then(async (r) => {
          if (gen !== renderGen) return;
          const j = r.ok ? await jsonOf(r) : null;
          if (j && j.from) what.replaceChildren(el('b', { textContent: `@${j.from}` }), document.createTextNode(' sent you a link to be friends.'));
          else if (r.status === 400) { unstash('apex.invite'); what.textContent = 'That friend link has been used or has run out. Ask for a new one.'; actions.replaceChildren(btn('OK', redo, 'linkbtn')); }
        }).catch(() => {});
        actions.append(btn('Accept', async () => {
          const r = await apiCall('POST', '/api/invites/redeem', { token: friendTok }).catch(() => null);
          if (r && (r.ok || r.status < 500)) unstash('apex.invite');
          toast(r && r.ok ? 'You\'re friends. Their profile has what you share.' : r ? 'That friend link didn\'t work. Ask for a new one.' : 'Couldn\'t reach Vetta. Try again.'); redo();
        }, 'ink-btn solid'), btn('Not now', () => { unstash('apex.invite'); redo(); }, 'linkbtn'));
        body.append(el('div', { className: 'card stack-8' }, what, actions));
      }
      const flist = el('div', { className: 'friend-list' });
      for (const { f, st } of order) {
        const row = el('div', { className: 'friend' });
        const av = window.ApexPhotos ? ApexPhotos.avatar((where.get(f.handle) || {}).photo_id || null, f.handle || '?', 40) : el('span');
        const head = el('button', { className: 'friend-head', type: 'button' }, av,
          el('span', { className: 'friend-who' }, el('b', { textContent: `@${f.handle || '?'}` }), el('small', { className: st && st.live ? 'live' : '', textContent: st && st.text ? st.text : (f.name || '') })),
          el('i', { className: 'chev', 'aria-hidden': 'true' }));
        head.setAttribute('aria-label', `@${f.handle || '?'}${st && st.text ? `, ${st.text}` : ''}: open the profile`);
        head.addEventListener('click', () => (window.ApexProfileView ? openProfile(f) : null));
        row.append(head);
        if (openFriendHandle && f.handle && f.handle.toLowerCase() === openFriendHandle) { openFriendId = f.id; openFriendHandle = null; }
        if (openFriendId === f.id && window.ApexProfileView) openProfile(f);
        flist.append(row);
      }
      if (accepted.length) body.append(flist);
      // Sharing came on for existing friends and private crews too (migration 0050, the owner 2026-11-11): said once
      if (accepted.length) {
        let told = false; try { told = !!localStorage.getItem('apex.sharingOnTold'); } catch (_) {}
        if (!told) { try { localStorage.setItem('apex.sharingOnTold', '1'); } catch (_) {} toast('Friends and private crews see your Scores and times now. Change it on their profile.'); }
      }
      // P-08: no friends yet is one sentence and the Invite key, not four empty drawers
      // the first friend is a page like the signed-out one (round three, 2026-11-11): your road drawn, the friend's still pencil
      else body.append(el('div', { className: 'people-first' },
        drawing(roads('M-12 34 C 70 34 96 96 176 92 S 300 24 372 50') + '<path class="jr-ghost" d="M92 140 C 108 112 148 98 176 92"/>' + pucks([277, 60, true])),
        el('h3', { className: 'join-head', textContent: 'Bring a friend.' }),
        el('p', { className: 'people-lead', textContent: 'They sign in with your link, and you’re friends the moment they do.' })));

      // One Invite key (the owner, 2026-10-30): someone new gets an invite link, a member your handle or a request; requests here too.
      const ipop = popSheet('Invite'); pops.push(ipop);
      ipop.querySelector('.side-pop-head button').addEventListener('click', () => { inviteOpen = false; unstash('apex.add'); });
      const add = el('input', { className: 'field', placeholder: 'Their handle', autocomplete: 'off', autocapitalize: 'none', 'aria-label': 'Friend handle', value: stash('apex.add'), enterKeyHint: 'send' });
      // the phone keyboard's Send key sends, as on any messaging app (walkthrough 2026-11-12: Return did nothing); once at a time
      let sending = false;
      const sendRequest = async () => {
        const h = add.value.trim().replace(/^@/, '').toLowerCase(); if (!h) { add.focus(); return; }
        if (sending) return; sending = true;
        try { await sendTo(h); } finally { sending = false; }
      };
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendRequest(); } });
      const sendTo = async (h) => {
        const r = await apiCall('POST', '/api/friends/request', { handle: h }); unstash('apex.add'); add.value = '';
        if (r.ok && !accepted.some(f => f.handle === h)) setSent([...sentList().filter(x => x !== h), h]);
        toast(r.ok ? `Request sent. @${h} sees it if that's their handle.` : 'Couldn\'t send that. Try again.'); redo();
      };
      // P-05: a request in is a card on the list, not a drawer here; the sheet keeps the requests you sent
      const reqSec = el('div', { className: 'stack-8' }, ...(waiting.length ? [el('h3', { textContent: 'Requests you sent' })] : []));
      for (const h of waiting) reqSec.append(el('div', { className: 'friend-sent' }, el('span', { textContent: `@${h} · request sent` }),
        btn('Cancel', async () => { await apiCall('POST', '/api/friends/request/cancel', { handle: h }); setSent(sentList().filter(x => x !== h)); redo(); }, 'linkbtn')));
      ipop.append(
        // one link for anyone, new to Vetta or not: a newcomer is your friend when they sign in, a member is asked first
        el('div', { className: 'stack-8' },
          btn('Send a friend link', async () => { const r = await apiCall('POST', '/api/invites'); const j = await jsonOf(r); if (r.ok) copyText(j.url, 'Link copied. You\'re friends once they open it, and you both get 5 points when they first share road data.'); else toast('Couldn\'t make an invite. Try again.'); }, 'ink-btn solid'),
          el('div', { className: 'row' }, add, btn('Send request', sendRequest)),
          btn('A link anyone can use', () => copyText(`${shareOrigin()}/?add=${me.handle}`, 'Link copied. Anyone who opens it can ask to be your friend.'), 'linkbtn')),
        reqSec);
      const openInvite = () => { inviteOpen = true; ipop.classList.add('open'); };
      if (stash('apex.add') && peopleSide === 'friends') inviteOpen = true;   // a friend link opens its sheet, never over the Crews side
      if (inviteOpen) ipop.classList.add('open');
      body.append(el('div', { className: 'row' }, btn('Invite or add a friend', () => openInvite(), 'ink-btn solid')));
      if (!accepted.length && window.ApexPeopleSamples) body.append(ApexPeopleSamples.friend(el));   // U-121: what arrives here, as an example

      // P-13, P-14, P-19: what friends shared with you is the one row left; spots went to Where to?, the points to the Garage,
      // who sees you to the You row above
      // Roadbooks (roadbooks.js) sit under it in the same list: yours, followed, near you. P-08: a new account with no friends
      // and no book yet keeps its one sentence and one key; its first roadbook starts from a route card's Share.
      const friendRows = el('div', { className: 'nav-rows' });
      if (shared.length || accepted.length) {
        let sharedRow = null;
        sharedRow = navRow('From friends', sharedRoutesSection((n) => { if (sharedRow) sharedRow._count.textContent = n ? `${n} route${n === 1 ? '' : 's'}` : ''; }, Promise.resolve(sharedList)));   // U-125: the count says what it counts
        friendRows.append(sharedRow);
      }
      booksRowCount = null;
      if (roadbooks && (shared.length || accepted.length || roadbooks.hasAny())) {
        let booksRow = null;
        const say = (t) => { if (booksRow) booksRow._count.textContent = t; };
        booksRow = navRow('Roadbooks', roadbooks.section(say));
        booksRowCount = () => { const l = roadbooks.lists(); if (l) say([l.mine.length ? `${l.mine.length} yours` : '', l.following.length ? `${l.following.length} followed` : ''].filter(Boolean).join(' \u00b7 ')); };
        friendRows.append(booksRow);
      }
      if (friendRows.children.length) body.append(friendRows);
      if (stash('apex.add') && add.value && !accepted.some(f => f.handle === add.value)) add.focus();

      // ---- Crews: your crew's page, its drives, the convoy, crews near you and a new one; crew invites live in a crew ----
      const myCrews = Array.isArray(crews) ? crews : [], crewList = myCrews;
      // In a crew, its page is the Crews side; the list of your crews (sharing, invite links, leave) is the settings
      // sheet behind the gear, and the lists you browse are rows (REVIEW2.md U-30). Not in one yet, they are the side.
      const inCrew = !!(crewPage && myCrews.length);
      const crewSettings = popSheet('Crew settings'); pops.push(crewSettings);
      // P-31: the gear is the settings of the crew on the page: what it sees of yours, its links and who can find it (the
      // owner), and Leave. Its members are on the page now (P-06), Report and Block one tap into each.
      const crewSettingsFor = (c) => {
        const g = grants.get('crew:' + c.id) || { share_scores: 0, share_times: 0 }, box = el('div', { className: 'stack-12 crew-settings' });
        const count = typeof c.members === 'number' ? c.members : Array.isArray(c.members) ? c.members.length : 0;
        const kind = c.visibility === 'public' ? `Public${c.area_name ? ' · ' + c.area_name : ''}` : 'Private';
        // owner: switch between private (invite link) and public (people nearby can find it; needs an area name)
        const ownerBox = el('div', { className: 'stack-8' });
        if (c.role === 'owner') {
          // P-07: any member can invite (a mate brings a mate) unless the owner keeps it to themselves; Owner voids the members' links
          const by = el('div', { className: 'switch', role: 'radiogroup' });
          by.setAttribute('aria-label', `Who can invite to ${c.name}`);
          for (const [v, label] of [['anyone', 'Any member'], ['owner', 'Owner']]) {
            const b = el('button', { type: 'button', role: 'radio', textContent: label });
            b.setAttribute('aria-checked', String((c.invites || 'anyone') === v));
            b.addEventListener('click', async () => {
              if ((c.invites || 'anyone') === v) return;
              const r = await apiCall('PUT', `/api/crews/${c.id}/invites`, { by: v });
              if (r.ok) { c.invites = v; by.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); toast(v === 'owner' ? `Only you can invite to ${c.name} now. Links other members made no longer work.` : `Anyone in ${c.name} can invite now.`); }
              else toast('Couldn\'t change that. Try again.');
            });
            by.append(b);
          }
          // 2026-11-10: the sheet in the Settings list's shape (a small-caps name over each part). "Who can invite" had its
          // explanation set beside it, so the label broke over two lines; the explanation is a line of its own under the keys.
          ownerBox.append(el('h4', { className: 'nav-group', textContent: 'Who can invite' }), by,
            el('p', { className: 'note', textContent: 'Whoever opens a crew link joins, and is friends with the sender.' }));
          ownerBox.append(btn('Turn off invite links', async () => {
            if (!(await ApexConfirm.ask(`Turn off every invite link to ${c.name}? People already in stay in.`, 'Turn off'))) return;
            const r = await apiCall('DELETE', `/api/crews/${c.id}/invites`); const j = await jsonOf(r);
            toast(r.ok ? (j.revoked ? `Old links to ${c.name} no longer work.` : `${c.name} had no open links.`) : 'Couldn\'t change that. Try again.');
          }, 'linkbtn'));
          ownerBox.append(el('h4', { className: 'nav-group', textContent: 'Who can find it' }));
          if (c.visibility === 'public') ownerBox.append(el('p', { className: 'note', textContent: c.area_name ? `Public: people near ${c.area_name} can find and join it.` : 'Public: people nearby can find and join it.' }), btn('Make private', async () => { const r = await apiCall('PUT', `/api/crews/${c.id}`, { visibility: 'private', about: c.about || '' }); if (r.ok) redo(); else toast('Couldn\'t change that. Try again.'); }, 'linkbtn'));
          else {
            const areaIn = el('input', { className: 'field', placeholder: 'Area, like Robbinsville', maxLength: 60, autocomplete: 'off' });
            areaIn.setAttribute('aria-label', 'Area people nearby will see');
            ownerBox.append(el('p', { className: 'note', textContent: 'Private: link only. Public: people near the area you name can find it.' }),
              el('div', { className: 'row' }, areaIn, btn('Make public', async () => {
              const near = crewNear(), name = areaIn.value.trim();
              if (name.length < 2) { toast('Name the area people nearby will see.'); return; }
              // what going public costs the members is said once, when it happens (it was a paragraph under the field)
              if (!(await ApexConfirm.ask(`Make ${c.name} public? Members' shared Scores, routes and stages stop showing until each says yes again.`, 'Make public'))) return;
              const r = await apiCall('PUT', `/api/crews/${c.id}`, { visibility: 'public', about: c.about || '', area: { name, lat: near.lat, lon: near.lon } });
              if (r.ok) { toast(`${c.name} is public. People near ${name} can find and join it.`); redo(); } else toast('Couldn\'t change that. Try again.');
            })));
          }
        }
        box.append(el('div', { className: 'stack-8' }, el('b', { textContent: c.name }), el('span', { className: 'note', textContent: `${count} ${count === 1 ? 'member' : 'members'} · ${kind}${c.role === 'owner' ? ' · you run it' : ''}` })),
          el('div', { className: 'stack-8' }, el('h4', { className: 'nav-group', textContent: 'What it sees of yours' }),
            el('div', { className: 'row' }, switchRow('Scores', g.share_scores, () => putGrant('crew', c.id, !g.share_scores, g.share_scores ? g.share_times : false)),
              switchRow('Times', g.share_times, () => putGrant('crew', c.id, true, !g.share_times))),
            el('p', { className: 'note', textContent: g.share_scores ? (g.share_times ? `${c.name} sees your scores and times.` : `${c.name} sees your scores.`) : `${c.name} sees nothing of yours yet.` })),
          ownerBox,
          // P-07: the crew page's Invite is the one invite key; the gear keeps who can invite, and Leave
          el('div', { className: 'row' },
            btn('Leave', async () => { if (await ApexConfirm.ask(`Leave ${c.name}?`, 'Leave')) { await apiCall('DELETE', `/api/crews/${c.id}/membership`); redo(); } }, 'danger-btn')));
        return box;
      };
      // A crew link asks first: joining shows your handle to its members, so it is never done for you by opening a link.
      if (stash('apex.crew')) {
        const tok = stash('apex.crew');
        const what = el('p', { textContent: 'You have a crew link.' });
        const why = el('p', { className: 'note', textContent: 'Its members will see your handle, and your car if you show it to crews.' });
        const actions = el('div', { className: 'row' });
        const show = (j) => {   // name the crew before the yes
          if (j.member) { unstash('apex.crew'); toast(`You're already in ${j.name}.`); redo(); return; }
          what.replaceChildren(document.createTextNode('Join '), el('b', { textContent: j.name }), document.createTextNode('?'));
          why.textContent = `${j.visibility === 'public' ? 'Public' : 'Private'} crew · ${j.members} ${j.members === 1 ? 'member' : 'members'}${j.owner ? ' · run by @' + j.owner : ''}. Its members will see your handle, and your car if you show it to crews.${j.from ? ` You and @${j.from}, who sent the link, will be friends.` : ''}`;
        };
        if (crewPreview.token === tok && crewPreview.data) show(crewPreview.data);
        else (async () => {
          let r = null, j = null;
          try { r = await apiCall('POST', '/api/crews/invite/preview', { token: tok }); j = r.ok ? await jsonOf(r) : null; } catch (_) {}
          if (gen !== renderGen) return;   // a newer render owns the screen
          if (j && j.name) { crewPreview.token = tok; crewPreview.data = j; show(j); }
          else if (r && r.status === 400) {
            unstash('apex.crew');
            what.textContent = 'That crew link has run out or doesn\'t work for you. Ask for a new one.'; why.remove();
            actions.replaceChildren(btn('OK', redo, 'linkbtn'));
          }
        })();
        cbody.append(el('div', { className: 'card stack-8' }, what, why, actions));
        actions.append(btn('Join crew', async (e) => {
            const b = e && e.currentTarget; if (b) { if (b.disabled) return; b.disabled = true; }
            let r = null;
            try { r = await apiCall('POST', '/api/crews/join', { token: tok }); } catch (_) {}
            if (b) b.disabled = false;
            if (!r) { toast('Couldn\'t join. Check signal and try again.'); return; }
            if (r.ok || (r.status >= 400 && r.status < 500)) unstash('apex.crew');
            const j = r.ok ? await jsonOf(r).catch(() => null) : null;   // P-02: the link friends its sender too
            toast(r.ok ? (j && j.friend ? `You're in the crew, and friends with @${j.friend}.` : 'You joined the crew.') : r.status < 500 ? 'That crew link didn\'t work. Ask for a new one.' : 'Couldn\'t join. Check signal and try again.');
            if (j && j.public) await askPublicSharing(j.id, 'this crew');
            redo();
          }, 'ink-btn solid'), btn('Not now', () => { unstash('apex.crew'); redo(); }, 'linkbtn'));
      }
      if (inCrew) {
        // TestFlight 2026-11-05 ("will this menu get convoluted if people are in a lot of crews?"): in two or more, the
        // Crews side is a dashboard of them (pinned first, a feed of the latest from all of them, crew_page.js dashboard);
        // a crew opens from it, with a key back. In one, its page is the side, as before.
        const many = myCrews.length > 1 && !!crewPage.dashboard;
        if (openCrewId && myCrews.some((c) => c.id === openCrewId)) { crewOpen = openCrewId; openCrewId = null; }   // just joined: that crew
        if (!many) crewOpen = myCrews[0].id;
        else if (!myCrews.some((c) => c.id === crewOpen)) crewOpen = null;
        const holder = el('div', { className: 'stack-8' }), chead = el('div', { className: 'crew-head' });
        const gear = el('button', { className: 'gear-key', type: 'button', 'aria-label': 'Crew settings', innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="8" stroke-width="3.2" stroke-dasharray="3.1 3.18"/></svg>' });
        gear.addEventListener('click', () => crewSettings.classList.add('open'));
        const openCrew = (id) => {
          crewOpen = id || null;
          const cur = myCrews.find((c) => c.id === crewOpen);
          if (!cur) { chead.replaceChildren(); chead.hidden = true; holder.replaceChildren(crewPage.dashboard(myCrews, openCrew)); }
          else {
            chead.hidden = false; chead.classList.toggle('solo', !many);
            const back = many ? btn('Your crews', () => { openCrew(null); const k = holder.querySelector('.cd-open'); if (k) k.focus({ preventScroll: true }); }, 'linkbtn cd-back') : el('span');   // one crew: its page's title says the name, so the head is the gear alone (it said it twice)
            if (many) back.setAttribute('aria-label', 'Back to your crews');
            chead.replaceChildren(back, gear);
            holder.replaceChildren(crewPage.view(cur.id));
            crewSettings.replaceChildren(crewSettings.firstElementChild, crewSettingsFor(cur));
          }
          const sc = cbody.closest('.body') || cbody.parentElement; if (sc && sc.scrollTop) sc.scrollTop = 0;
        };
        openCrew(crewOpen);
        cbody.append(chead, holder);
      }
      // not in a crew yet: what one is (in one, its settings are the gear's, above)
      const csec = section('Your crews');
      if (!crewList.length) csec.append(el('p', { className: 'note', textContent: 'A crew is a group for a club or a weekend run. You can be in several. Join one near you, or start one.' }));
      if (!inCrew && crewList.length) cbody.append(csec);   // P-08: no crews, no empty "Your crews"
      // new crew: private (invite link) or public (findable nearby by an area you name)
      const newSec = section('Start a crew');
      const cname = el('input', { className: 'field', placeholder: 'New crew name', autocomplete: 'off', maxLength: 40, 'aria-label': 'Crew name' });
      // private (an invite link) or public (people nearby can find it, by an area you name): a slide switch under its own label
      const cvis = el('div', { className: 'switch', role: 'radiogroup', value: 'private' });
      cvis.setAttribute('aria-label', 'New crew');
      const carea = el('input', { className: 'field', placeholder: 'Area people nearby will see, like Robbinsville', maxLength: 60, autocomplete: 'off', hidden: true });
      for (const [v, label] of [['private', 'Private'], ['public', 'Public']]) {
        const b = el('button', { type: 'button', role: 'radio', textContent: label });
        b.addEventListener('click', () => { cvis.value = v; carea.hidden = v !== 'public'; cvis.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); });
        b.setAttribute('aria-checked', String(v === 'private'));
        cvis.append(b);
      }
      // TestFlight 2026-11-05 ("bad when typing new crew info"): in the order it is filled in, the name first and full width,
      // who can join under its own label with the explanation on its own line, then Create
      cname.classList.add('new-crew-name'); carea.classList.add('new-crew-area');
      const create = btn('Create crew', async () => {
        if (!cname.value.trim()) { cname.focus(); return; }
        const pub = cvis.value === 'public', near = crewNear();
        if (pub && carea.value.trim().length < 2) { toast('Name the area people nearby will see.'); return; }
        if (create.disabled) return; create.disabled = true;   // a second tap or Return while it saves makes no second crew
        let r = null;
        try { r = await apiCall('POST', '/api/crews', pub ? { name: cname.value.trim(), visibility: 'public', area: { name: carea.value.trim(), lat: near.lat, lon: near.lon } } : { name: cname.value.trim() }); } catch (_) {}
        create.disabled = false;
        if (r && r.ok) redo(); else toast('Couldn\'t create the crew.'); }, 'ink-btn solid');
      // Return on the keyboard: from the name, Create (or on to the area for a public crew); from the area, Create
      cname.enterKeyHint = 'next'; carea.enterKeyHint = 'go';
      cname.addEventListener('keydown', (e) => { if (e.key !== 'Enter' || e.isComposing) return; e.preventDefault(); if (!carea.hidden && carea.value.trim().length < 2) carea.focus(); else create.click(); });
      carea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); create.click(); } });
      newSec.append(cname, el('div', { className: 'new-crew-who' }, el('b', { textContent: 'Who can join' }), el('small', { textContent: 'Private: by invite link. Public: people nearby can find it.' })), cvis, carea, create);

      // public crews near you: tiles with Join (only name, area and size are shown; members stay private)
      let nearbyRow = null;
      const nsec = section('Crews near you'), near = crewNear();
      // VI-1: asked by the 0.1-degree cell, and not at all from a privacy zone (said so, never "none near you")
      const discover = nearLookupOk(near) ? apiCall('GET', `/api/crews/discover?${ApexPrivacyZones.cellQuery(near.lat, near.lon)}`).then(jsonOf).catch(() => null) : Promise.resolve('private');
      discover.then((found) => {
        if (gen !== renderGen) return;
        if (found === 'private') { nsec.append(el('p', { className: 'note', textContent: 'You\'re in a privacy zone, so crews nearby aren\'t looked up from here.' })); return; }
        const nearby = Array.isArray(found) ? found : [];
        if (nearbyRow) nearbyRow._count.textContent = nearby.length ? `${nearby.length} crew${nearby.length === 1 ? '' : 's'} near you` : '';   // U-125
        if (!nearby.length) { nsec.append(el('p', { className: 'note', textContent: found ? 'No public crews near you yet.' : 'Couldn\'t look for crews nearby. Check signal.' })); return; }
        const ntiles = el('div', { className: 'crew-tiles one' });   // P-26: one a row, the name whole
        for (const c of nearby) {
          const t = el('div', { className: 'card' });
          t.append(el('div', { className: 'crew-tile-head' }, el('b', { textContent: c.name }),
            el('span', { textContent: `${c.members} ${c.members === 1 ? 'member' : 'members'} · ${c.area_name}${Number.isFinite(c.km) ? ` · ${ApexUnits.long(Math.max(1609.344, c.km * 1000), 0)}` : ''}` }),
            ...(c.about ? [el('em', { textContent: c.about })] : [])),
            el('div', { className: 'row' },
              btn('Join', async () => { const r = await apiCall('POST', `/api/crews/${c.id}/join`); if (r.ok) { toast(`You joined ${c.name}.`); await askPublicSharing(c.id, c.name); openCrewId = c.id; redo(); } else toast(r.status === 429 ? 'You\'re in 10 crews already.' : 'Couldn\'t join. Try again.'); }, 'ink-btn solid'),
              ...(safety ? [btn('Report', () => safety.report({ kind: 'crew', target: c.id, label: c.name, done: redo }), 'linkbtn')] : [])));
          ntiles.append(t);
        }
        nsec.append(ntiles);
      });
      // Crew drives (crew_events.js): planned drives across your crews, RSVPs and meets near you
      // P-08: only once there is a crew to plan for
      // in a crew, the crew page's Upcoming drives carries them (the owner's TestFlight note 05): no Crew drives row
      const drives = crewEvents && myCrews.length && !inCrew ? (crewDrivesEl = crewEvents.section(myCrews.map((c) => ({ id: c.id, name: c.name, visibility: c.visibility, role: c.role })))) : (crewDrivesEl = null);
      // Find or start a crew (REVIEW_PEOPLE 2): the crews near you and a new one, one sheet behind one row
      const findSheet = () => el('div', { className: 'stack-12' }, nsec, newSec);
      if (inCrew) {
        const rows = el('div', { className: 'nav-rows' });
        rows.append(nearbyRow = navRow('Find or start a crew', findSheet()));
        cbody.append(rows);
      } else {
        if (myCrews.length) cbody.append(nsec, newSec);
        // P-08: no crew yet is one sentence and one row, not five empty drawers
        else cbody.append(el('div', { className: 'people-first' },
            drawing(roads('M-12 96 C 60 96 84 36 156 36 S 262 98 372 70') + [[72, 66], [98, 50], [128, 39]].map(([x, y]) => `<circle class="jr-seat" cx="${x}" cy="${y}" r="7"/>`).join('') + pucks([173, 37, true])),   // the lead, three seats in file still empty
            el('h3', { className: 'join-head', textContent: 'Start a crew.' }),
            el('p', { className: 'people-lead', textContent: 'A group for a club or a weekend run: its own page, and drives you plan together.' })),
          el('div', { className: 'nav-rows' }, nearbyRow = navRow('Find or start a crew', findSheet())));
        if (!myCrews.length && window.ApexPeopleSamples) cbody.append(ApexPeopleSamples.crew(el));   // U-121: what a crew looks like, as an example
        if (drives) cbody.append(drives);
      }
      // P-11: no Convoy section. A crew's convoy is its drive's card; an ad-hoc one is the map's Start key (Convoy now).
      if (crewStandings && myCrews.length) cbody.append(crewStandings.section());
      document.querySelectorAll('.side-pop.people-pop').forEach(n => n.remove());       // People's sheets: on the page, not inside the sliding sheet
      document.body.append(...pops);
      if (garage) gbody.append(garage.section());
      if (builds) gbody.append(builds.followingSection());

      // road feel + account
      const contribOn = !!(me && me.contribute);
      ambientFromAccount(true, contribOn);                                    // U-116
      const dsec = rfBody === gbody ? section('Road feel') : el('div', { className: 'stack-8' });   // the sheet's head says Road feel
      dsec.append(switchRow('Share road feel', contribOn, async () => { const r = await apiCall('PUT', '/api/me/contribute', { on: !contribOn }); if (contribOn && r && r.ok) clearCarry(); redo(); }),
        // U-126: no multiplier of nothing: what the app shows for mapping a road first is the count below, for you only
        el('p', { className: 'note', textContent: 'Banking, bumps and surface. Never where you went or how fast. Roads you map first are counted here, for you only.' }));
      // P-14: your own contribution, not a board of friends: roads you were first or second to map (IDEAS S-09); only you see it
      const pio = pts && pts.pioneer;
      if (pio && (pio.firsts || pio.seconds)) dsec.append(el('p', { className: 'note pioneer', textContent: [pio.firsts ? `Roads you mapped first: ${pio.firsts}` : '', pio.seconds ? `second to map ${pio.seconds}` : ''].filter(Boolean).join(' · ') }));
      rfBody.append(dsec);
      const asec = accBody === gbody ? section('Account') : el('div', { className: 'stack-8' });
      const itemsOn = !(window.ApexItemSync && ApexItemSync.isOff(localStorage));
      asec.append(switchRow('Saved routes and places on my account', itemsOn, async () => {
        if (!(await ApexItemSync.setOn(localStorage, me.id, !itemsOn, apiCall))) { toast('No connection. Try again with signal.'); return; }
        if (!itemsOn) syncItems(true);
        redo();
      }), el('p', { className: 'note', textContent: itemsOn ? 'On every phone you sign in on. Only you see them.' : 'Off: kept on this phone only.' }));
      asec.append(el('div', { className: 'row' },
        btn('Download my data', downloadMyData),
        btn('Sign out', async () => { await pushForgetHere(); await apiCall('POST', '/api/auth/logout'); ApexSync.setSession(null); clearCarry(); clearCrowd(); redo(); })),
        btn('Delete account', deleteMyAccount, 'danger-btn'));
      accBody.append(asec);                                                 // your account: Garage → Settings → Account
      if (safety) { accBody.append(safety.blockedSection()); if (me.moderator) accBody.append(safety.moderationSection()); }
      // the owner's service check runs by itself once a launch, at most every 6 h, once the map is idle (its results go to D1)
      if (me.moderator && !svcRun && !svcLast && serviceCheckDue()) setTimeout(() => !document.hidden && runServiceCheck().then((r) => { svcLast = r; }).catch(() => {}), 8000);
      if (me.moderator) accBody.append(serviceCheckSection(), errorsSection(), healthSection(), latencySection(), ...(window.ApexFeedback ? [ApexFeedback.ownerSection({ el, btn, apiCall, jsonOf })] : []));
    }

    // Highlights (local for now): [{id, name, lat, lon, rating}] in localStorage; the server list joins later (docs/BACKEND.md section 9).
    // Planning uses your own spots plus members' shared ones near the start (offline: just yours). A shared spot you already added is not counted twice.
    async function allHighlights(c) {
      const mine = loadHighlights();
      if (!window.ApexSync) return mine;
      const shared = await Promise.race([ApexSync.highlightsNear(c), new Promise(r => setTimeout(() => r([]), 4000))]);
      const near = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lon - b.lon) * 91000) < 60;
      return mine.concat(shared.filter(s => !mine.some(m => near(m, s))));
    }
    function loadHighlights() { try { return JSON.parse(localStorage.getItem('apex.highlights') || '[]'); } catch (_) { return []; } }
    function saveHighlights(list) { try { localStorage.setItem('apex.highlights', JSON.stringify(list)); } catch (_) {} }
    function renderHighlights() {
      document.querySelectorAll('#detourList [data-detour]').forEach(b => b.classList.toggle('on', state.hlOn ? parseFloat(b.dataset.detour) === state.hlStrength : b.dataset.detour === '0'));
      const list = $('hlList'); list.innerHTML = '';
      for (const h of loadHighlights()) {
        const row = document.createElement('div'); row.className = 'row'; row.style.cssText = 'justify-content:space-between;align-items:center;font-size:13px';
        const t = document.createElement('span'); t.textContent = `${'★'.repeat(h.rating)} ${h.name}`;
        const x = document.createElement('button'); x.className = 'ink-btn'; x.textContent = '×'; x.setAttribute('aria-label', `Remove ${h.name}`);
        x.onclick = () => { saveHighlights(loadHighlights().filter(v => v.id !== h.id)); if (h.photo && window.ApexSpotPhotos) ApexSpotPhotos.remove(h.id); renderHighlights(); };
        if (h.photo && window.ApexSpotPhotos) row.append(spotThumb(h));
        row.append(t);
        if (!h.shared && window.ApexSync) {
          const sh = document.createElement('button'); sh.className = 'ink-btn'; sh.textContent = 'Share'; sh.hidden = true;
          ApexSync.member().then(m => { sh.hidden = !m; });
          sh.onclick = async () => {
            sh.disabled = true;
            const ok = await ApexSync.shareHighlight(h, h.category || 'other');
            if (ok) { saveHighlights(loadHighlights().map(v => v.id === h.id ? { ...v, shared: true } : v)); renderHighlights(); toast('Shared. Other members can now rate it.'); }
            else { sh.disabled = false; toast('Not shared. There\'s already a spot here, or you\'ve hit today\'s limit.'); }
          };
          row.append(sh);
        } else if (h.shared) { const tag = document.createElement('span'); tag.className = 'note'; tag.textContent = 'shared'; row.append(tag); }
        row.append(x); list.appendChild(row);
      }
    }
    // The photo kept with one of your spots (spot_photos.js, IDEAS S-18): a thumbnail that opens it full size.
    function spotThumb(h) {
      const b = document.createElement('button'); b.className = 'spot-thumb'; b.setAttribute('aria-label', `Photo of ${h.name}`); b.hidden = true;
      ApexSpotPhotos.get(h.id).then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob), img = document.createElement('img'); img.src = url; img.alt = ''; b.append(img); b.hidden = false;
        b.onclick = () => {
          const ov = document.createElement('div'); ov.className = 'overlay dim show spot-photo'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', h.name);
          const big = document.createElement('img'); big.src = url; big.alt = h.name;
          const close = document.createElement('button'); close.className = 'ink-btn'; close.textContent = 'Close';
          onBackdrop(ov, () => ov.remove()); close.onclick = () => ov.remove();
          ov.append(big, close); document.body.append(ov); close.focus();
        };
      });
      return b;
    }
    // Members' shared spots near you, each rateable once signed in (the author can't rate their own; the server enforces it).
    async function renderNearbyHighlights() {
      const box = $('hlNearby'); box.innerHTML = '';
      if (!window.ApexSync || !(await ApexSync.member())) return;
      const list = await ApexSync.highlightsNear(here());
      for (const s of list.slice(0, 8)) {
        const row = document.createElement('div'); row.className = 'row'; row.style.cssText = 'justify-content:space-between;align-items:center;font-size:13px';
        const t = document.createElement('span'); t.textContent = `${s.rating.toFixed(1)}★ ${s.name} (${s.ratings})`;
        row.append(t);
        if (!s.mine) for (const n of [1, 3, 5]) {
          const b = document.createElement('button'); b.className = 'ink-btn'; b.textContent = `${n}★`; b.setAttribute('aria-label', `Rate ${s.name} ${n} stars`);
          b.onclick = async () => { toast((await ApexSync.rateHighlight(s.id, n)) ? 'Rated.' : 'Couldn\'t rate it. Try again.'); renderNearbyHighlights(); };
          row.append(b);
        }
        box.append(row);
      }
    }
    document.querySelectorAll('#detourList [data-detour]').forEach(b => b.addEventListener('click', () => {
      const v = parseFloat(b.dataset.detour); state.hlOn = v > 0; if (v > 0) state.hlStrength = v;
      savePrefs(); renderHighlights(); if (state.hlOn) renderNearbyHighlights();
    }));
    let highlightPoint = null, highlightCategory = 'other', highlightRating = 5, pendingPhoto = null;
    $('hlPhoto').addEventListener('change', async () => {
      const f = $('hlPhoto').files && $('hlPhoto').files[0]; pendingPhoto = null;
      if (!f) return;
      $('hlPhotoNote').textContent = 'Preparing the photo…';
      try { pendingPhoto = await ApexSpotPhotos.prepare(f); $('hlPhotoNote').textContent = 'Photo ready. Its location and camera details are removed.'; }
      catch (_) { $('hlPhotoNote').textContent = 'That file isn\'t a photo this phone can open.'; }
    });
    function selectHighlightCategory(value) {
      highlightCategory = value;
      document.querySelectorAll('#hlCategories button').forEach(b => {
        const on = b.dataset.category === value;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      });
    }
    function selectHighlightRating(value) {
      highlightRating = value;
      document.querySelectorAll('#hlRating button').forEach(b => {
        const n = Number(b.dataset.rating);                              // four stars is four stars filled, not the fourth
        b.classList.toggle('on', n <= value); b.setAttribute('aria-pressed', String(n === value));
      });
    }
    function openHighlightDialog(point) {
      if (state.mode === 'live') return;
      highlightPoint = point;
      $('hlName').value = '';
      selectHighlightCategory('other'); selectHighlightRating(5);
      pendingPhoto = null; $('hlPhoto').value = ''; $('hlPhotoNote').textContent = 'Stays on this phone, without its location data.';
      $('hlPhotoBtn').hidden = !window.ApexSpotPhotos;
      $('hlOverlay').classList.add('show');
      if (!document.body.classList.contains('moving')) $('hlName').focus();   // moving: no keyboard, Save names it
    }
    function closeHighlightDialog() { $('hlOverlay').classList.remove('show'); highlightPoint = null; }
    document.querySelectorAll('#hlCategories button').forEach(b => b.addEventListener('click', () => selectHighlightCategory(b.dataset.category)));
    document.querySelectorAll('#hlRating button').forEach(b => b.addEventListener('click', () => selectHighlightRating(Number(b.dataset.rating))));
    // Road data that waited for signal (road_carry.js, IDEAS Q-06) wires itself; the page counts its uploads for app health,
    // says when some went, and empties it when Road data is switched off, on sign-out and when the account is deleted, so
    // nothing measured under one account is sent under another (Erase everything clears its index with the apex.* keys).
    // Members' road data kept for plans (own_routing.js) is a member's: it leaves the phone on sign-out and account deletion.
    const clearCrowd = () => {
      try { if (window.ApexOwnRouting && ApexOwnRouting.clearCrowd) ApexOwnRouting.clearCrowd(); } catch (_) {}
      try { if (window.ApexRouteFeel) localStorage.removeItem(ApexRouteFeel.KEY); } catch (_) {}   // and kept with saved routes
    };
    const clearCarry = () => { try { localStorage.removeItem('apex.roadShare'); } catch (_) {} try { if (window.ApexRoadCarry && ApexRoadCarry.clear) ApexRoadCarry.clear(); } catch (_) {} };
    if (window.ApexRoadCarry && ApexRoadCarry.flush) {
      ApexRoadCarry.onPost = (r) => health.bump(r === true ? 'road_upload_ok' : 'road_upload_fail');
      ApexRoadCarry.onSent = (km) => { toast(`Sent ${ApexUnits.long(km * 1000, 1)} of road feel that waited for signal.`); renderMyData().catch(() => {}); };
    }
    // Your data (my_data.js, IDEAS Z-03 / Z-04): what this phone holds, drives as GPX, delete and erase.
    async function renderMyData() {
      // the summaries (F-06): each drive's length and battery, never its rows (the Garage opened with every drive read)
      let sums = await ApexRecording.summaries(null);
      if (sums.missing) sums = (await ApexAnalysis.job('summaries')).list;   // drives saved before summaries: built in the worker
      const list = sums.map((s) => ({ dist: [s.len_m || 0], battery: s.battery }));
      const s = ApexMyData.phoneSummary(list, localStorage);
      // no drives on the phone: no Download drives and no Delete drives that could only say so (free roamer B, 2026-11-14)
      $('myGpxBtn').hidden = $('myDrivesDelBtn').hidden = !list.length;
      $('myDataNote').textContent = ApexMyData.phoneText(s, (m) => ApexUnits.long(m))   // U-126: counts only what exists
        + (() => { const b = window.ApexBattery ? ApexBattery.overall(list) : null; return b ? ` Driving uses about ${b.perHour}% battery an hour on this phone (${b.drives} drive${b.drives === 1 ? '' : 's'}).` : ''; })();
      renderOffline();
    }
    // Offline data (IDEAS F-06): saved routes and downloaded voices, their size, and a delete. Drives are not offline data.
    async function voiceCacheBytes() {
      try {
        if (!window.caches || !(await caches.has('kokoro-voices'))) return 0;
        const c = await caches.open('kokoro-voices'); let n = 0;
        for (const req of await c.keys()) { const r = await c.match(req); if (r) n += (await r.clone().arrayBuffer()).byteLength; }
        return n;
      } catch (_) { return null; }
    }
    // what the car map's own offline packs hold (the shell says, CarPlay/ApexCarOffline.swift); unknown off the app
    let carOfflineBytes = null;
    async function renderOffline() {
      let est = {};
      try { est = (navigator.storage && navigator.storage.estimate) ? await navigator.storage.estimate() : {}; } catch (_) {}
      const o = { ...ApexMyData.offlineSummary(localStorage, await voiceCacheBytes(), est.usage, est.quota), carBytes: carOfflineBytes };
      renderAreas();
      const note = $('myOfflineNote'); if (note) note.textContent = ApexMyData.offlineText(o);
      $('myOfflineDelBtn').hidden = !(o.routes > 0) && !(o.areas > 0) && !(o.voiceBytes > 0);   // "Nothing saved for offline": nothing to delete
    }
    // a download on the web, the share sheet in the iOS app (save_file.js): a download link does nothing in the app's web view
    const saveFile = (text, name, type) => ApexSaveFile.saveFile(text, name, type);
    $('myGpxBtn').addEventListener('click', async () => {
      const list = await ApexRecording.all();
      if (!list.length) { toast('No drives on this phone yet.'); return; }
      saveFile(ApexMyData.toGpx(list), `vetta-drives-${new Date().toISOString().slice(0, 10)}.gpx`, 'application/gpx+xml');
    });
    $('myAccountBtn').addEventListener('click', async () => {
      let r = null;
      try { r = await ApexSync.apiFetch('/api/me/export', { method: 'GET' }); } catch (_) {}
      if (!r || r.status === 401) { toast(r ? 'Not signed in: there is no account data on the server.' : 'No signal. Try again.'); return; }
      if (!r.ok) { toast('Couldn\'t get your data. Try again.'); return; }
      saveFile(JSON.stringify(await r.json(), null, 2), 'vetta-account.json', 'application/json');
    });
    // Save the map here (offline_tiles.js, IDEAS F-02): the map, labels and terrain round the map's centre (25 km, less
    // when that would be over 2,500 tiles), so the map, loops, Explore and climbs work there with no signal.
    let areaBusy = false;
    // saves (or, with an old area's id and name, updates in place) the map round (lat, lon); `btn` shows the progress
    async function saveAreaAt(lat, lon, btn, { id = null, name = null, radiusKm = 25, idle } = {}) {
      if (areaBusy || !window.ApexOfflineTiles) return;
      areaBusy = true; btn.disabled = true;
      try {
        // a new area is named for its town (the map's reverse geocode, as the place plate asks it: to 0.01°), else its place
        let town = null;
        if (!name) { try { town = ApexPlacePlate.town(await RouteLoading.json(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&zoom=12&addressdetails=1`, {}, 6000)); } catch (_) {} }
        const a = await ApexOfflineTiles.download({ lat, lon, radiusKm, styleUrl: MAP_STYLE, id, name: name || (town ? `Around ${town}` : `Around ${lat.toFixed(2)}, ${lon.toFixed(2)}`),
          onProgress: (d, n) => { if (d % 25 === 0 || d === n) btn.textContent = `Saving the map… ${Math.round(100 * d / n)}%`; } });
        // members' road feel for the area too (signed in as a member): measured roads plan the same with no signal
        let roads = null;
        if (window.ApexOwnRouting && ApexOwnRouting.holdArea && window.ApexSync && (await ApexSync.member().catch(() => false))) {
          btn.textContent = 'Saving members\u2019 road feel…';
          roads = await ApexOwnRouting.holdArea(routeCtxOpts().lookupCells, ApexOwnRouting.cellsNear(lat, lon, a.radiusKm), a.id).catch(() => null);
          if (roads) ApexOfflineTiles.setArea(a.id, { roadCells: roads.held, roadOf: roads.cells, roadWays: roads.ways });
        }
        const part = partKept(a);
        if (part) toast(`The map ${id ? a.name.replace(/^Around /, 'round ') : 'here'}: only ${part}. Press Update to finish it.`);
        else toast(`${id ? 'Updated' : 'Saved'} ${ApexUnits.long(a.radiusKm * 1000, 0)} round ${id ? a.name.replace(/^Around /, '') : 'here'} for offline, ${(a.bytes / 1048576).toFixed(0)} MB${roads && roads.ways ? `, with ${roads.ways} measured roads` : ''}.`);
      } catch (_) { toast('Couldn\'t save the map. Check signal and try again.'); }
      finally { areaBusy = false; btn.disabled = false; btn.textContent = idle; renderMyData(); }
    }
    $('myAreaBtn').addEventListener('click', () => {
      if (!mapReady) return;
      const c = map.getCenter();
      saveAreaAt(c.lat, c.lng, $('myAreaBtn'), { idle: 'Save the map here for offline' });
    });
    function renderAreas() {
      const box = $('myAreas'); if (!box || !window.ApexOfflineTiles) return;
      box.replaceChildren(...ApexOfflineTiles.areas().map((a) => {
        const row = document.createElement('div'); row.className = 'row'; row.style.justifyContent = 'space-between';
        const feel = a.roadOf ? (a.roadCells < a.roadOf ? ' · members\u2019 road feel for part of it' : a.roadWays ? ` · ${a.roadWays} measured roads` : ' · no measured roads yet') : '';
        const t = document.createElement('span'); t.className = 'note'; t.textContent = `${a.name} · ${Number.isFinite(a.radiusKm) ? `${ApexUnits.long(a.radiusKm * 1000, 0)} round` : 'along the route'} · ${(a.bytes / 1048576).toFixed(0)} MB${feel}`;
        // how old the map is (roads, names and closures change): an area saved half a year ago offers to update in place
        const age = ApexOfflineTiles.ageOf(a, Date.now());
        if (age.month) t.textContent += ` · saved ${age.month}`;
        const part = partKept(a);
        if (part) t.textContent += ` · only ${part}`;
        const redo = age.stale || !!part;
        const acts = document.createElement('span'); acts.className = 'row';
        if (redo && Number.isFinite(a.radiusKm) && Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
          const up = document.createElement('button'); up.className = 'linkbtn'; up.textContent = 'Update';
          up.setAttribute('aria-label', `Update the map ${a.name}, ${part ? `only ${part}` : `saved ${age.month}`}`);
          up.addEventListener('click', () => saveAreaAt(a.lat, a.lon, up, { id: a.id, name: a.name, radiusKm: a.radiusKm, idle: 'Update' }));
          acts.append(up);
        }
        // a saved route's map: fetched again along the route as it is saved now (keepMapAlong, same id)
        const route = redo && !Number.isFinite(a.radiusKm) ? ApexSavedRoutes.list(localStorage).find((p) => routeAreaId(p) === a.id) : null;
        if (route) {
          const up = document.createElement('button'); up.className = 'linkbtn'; up.textContent = 'Update';
          up.setAttribute('aria-label', `Update the map along ${route.name}, ${part ? `only ${part}` : `saved ${age.month}`}`);
          up.addEventListener('click', async () => {
            if (up.disabled) return;
            up.disabled = true; up.textContent = 'Saving the map…';
            await keepMapAlong({ id: route.id, name: route.name, lat: route.coords.map((c) => c[1]), lon: route.coords.map((c) => c[0]) });
            const now = ApexOfflineTiles.areas().find((x) => x.id === a.id);
            if (!now || now.at === a.at) toast('Couldn\'t update the map. Check signal and try again.');
            renderMyData();
          });
          acts.append(up);
        }
        const del = document.createElement('button'); del.className = 'linkbtn'; del.textContent = 'Delete';
        del.addEventListener('click', async () => { await ApexOfflineTiles.removeArea(a.id); if (window.ApexOwnRouting && ApexOwnRouting.releaseArea) ApexOwnRouting.releaseArea(a.id); renderMyData(); });
        acts.append(del); row.append(t, acts); return row;
      }));
    }
    $('myOfflineDelBtn').addEventListener('click', async () => {
      if (!(await ApexConfirm.ask('Delete routes and map areas saved for offline, and downloaded voices? Your drives, spots and settings stay.', 'Delete'))) return;
      try { localStorage.removeItem(ApexSavedRoutes.KEY); if (window.ApexRouteReports) localStorage.removeItem(ApexRouteReports.KEY); if (window.ApexRouteFeel) localStorage.removeItem(ApexRouteFeel.KEY); } catch (_) {}
      try { if (window.ApexOfflineTiles) await ApexOfflineTiles.clear(); } catch (_) {}
      try { if (window.ApexOwnRouting && ApexOwnRouting.clearCrowd) await ApexOwnRouting.clearCrowd(); } catch (_) {}   // members' road data kept for plans
      try { if (window.caches) { await caches.delete('kokoro-voices'); for (const k of await caches.keys()) if (k.startsWith('apexnav-shell-')) await caches.delete(k); } } catch (_) {}
      toast('Offline data deleted.'); renderMyData();
    });
    $('myAccountDelGo').addEventListener('click', () => { if (window.ApexGarageSettings && ApexGarageSettings.ui) { ApexGarageSettings.ui.close(); ApexGarageSettings.ui.open('account'); } });
    $('myDrivesDelBtn').addEventListener('click', async () => {
      const list = await ApexRecording.ids();
      if (!list.length) { toast('No drives on this phone.'); return; }
      if (!(await ApexConfirm.ask(`Delete all ${list.length} drives from this phone? Download them first if you want to keep them.`, 'Delete drives'))) return;
      for (const id of list) { try { await ApexRecording.remove(id); } catch (_) {} }
      refreshSavedDrives().catch(() => {});
      toast('Drives deleted from this phone.'); renderMyData();
    });
    $('myEraseBtn').addEventListener('click', async () => {
      if (!(await ApexConfirm.ask('Erase drives, spots, zones, settings and sign-in from this phone? Your account on the server stays until you delete it in Garage → Settings → Account.', 'Erase everything'))) return;
      for (const id of await ApexRecording.ids()) { try { await ApexRecording.remove(id); } catch (_) {} }
      ApexSync.setSession(null);                                   // the app's Keychain session too (IDEAS Z-10)
      for (const k of ApexMyData.keysToClear(localStorage)) { try { localStorage.removeItem(k); } catch (_) {} }
      try { sessionStorage.clear(); } catch (_) {}
      try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch (_) {}
      try { if (window.ApexSpotPhotos) await ApexSpotPhotos.clear(); } catch (_) {}      // spot photos (IDEAS S-18)
      try { if (window.ApexOfflineTiles) await ApexOfflineTiles.clear(); } catch (_) {}  // offline map areas (IDEAS F-02)
      try { if (window.ApexOwnRouting && ApexOwnRouting.clearCrowd) await ApexOwnRouting.clearCrowd(); } catch (_) {}   // members' road data kept for plans
      location.reload();
    });
    renderMyData();
    // The place plate (place_plate.js): the town and the sky on the idle map. Asked with the position rounded to about a km,
    // again after 20 minutes or 5 km; each part only when it came back. Hidden while driving (the hazard plate's place).
    const placeAsk = { at: 0, lat: null, lon: null, data: {} };
    // REVIEW5 U-127: one rule for when it shows, in every theme: on the idle map, not under a drive's end card (Billet drew
    // it over the card), and back as soon as Done brings the idle map back (it waited up to a minute for the next refresh)
    function paintPlacePlate() {
      const pp = $('placePlate'), card = $('endCard');
      if (pp) pp.hidden = !pp.textContent || state.mode === 'live' || !$('app').classList.contains('idle') || !!(card && card.classList.contains('show'));
    }
    async function refreshPlacePlate() {
      const p = state.lastPosition;
      paintPlacePlate();
      if (!p || navigator.onLine === false) return;
      const moved = placeAsk.lat == null ? Infinity : Math.hypot((p.lat - placeAsk.lat) * 111, (p.lon - placeAsk.lon) * 111 * Math.cos(p.lat * Math.PI / 180));
      if (Date.now() - placeAsk.at < 20 * 60000 && moved < 5) return;
      placeAsk.at = Date.now(); placeAsk.lat = p.lat; placeAsk.lon = p.lon;
      const la = p.lat.toFixed(2), lo = p.lon.toFixed(2), d = {};
      try { const r = await RouteLoading.json(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${la}&lon=${lo}&zoom=12&addressdetails=1`, {}, 6000); d.place = ApexPlacePlate.town(r); } catch (_) {}
      // the forecast's now and its last 3 hours of rain, and (US) the nearest NWS stations' latest observation, together
      const om = RouteLoading.json(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=temperature_2m,weather_code,precipitation&hourly=precipitation&past_hours=3&forecast_hours=1&timezone=GMT`, {}, 6000)
        .then((w) => { if (w && w.current) { d.tempC = w.current.temperature_2m; d.code = w.current.weather_code; d.mmNow = w.current.precipitation; } d.mm3h = ApexPlacePlate.pastMm(w); }).catch(() => {});
      const nws = (async () => {
        const pt = await RouteLoading.json(`https://api.weather.gov/points/${la},${lo}`, {}, 6000);
        const st = await RouteLoading.json(pt.properties.observationStations, {}, 6000);
        const ids = ((st && st.features) || []).slice(0, 3).map((f) => f.properties && f.properties.stationIdentifier).filter(Boolean);
        const got = await Promise.allSettled(ids.map((id) => RouteLoading.json(`https://api.weather.gov/stations/${id}/observations/latest`, {}, 6000)));
        const obs = got.filter((g) => g.status === 'fulfilled').map((g) => ApexPlacePlate.obsOf(g.value && g.value.properties)).filter(Boolean);
        obs.sort((a, b) => a.ageMin - b.ageMin);                         // the freshest of the nearest three
        d.obs = obs[0] || null;
      })().catch(() => {});
      await Promise.all([om, nws]);
      placeAsk.data = d;
      // Vetta Line: a masthead, the place set large and the sky as its line under it. The separator between them stays in the
      // text (not shown), so the plate still reads "Tellico Plains · Dry · 61°" to a screen reader and to textContent.
      { const pp = $('placePlate'), m = ApexPlacePlate.parts(d, ApexUnits.metric()), b = document.createElement('b');
        b.textContent = m.head; pp.replaceChildren(...(m.head ? [b] : []));
        if (m.rest) { const i = document.createElement('i'), sp = document.createElement('span'); i.textContent = ' · '; sp.textContent = m.rest; pp.append(i, sp); } }
      paintPlacePlate();
    }
    setTimeout(refreshPlacePlate, 4000); setInterval(refreshPlacePlate, 60000);
    window.apexDebug.placePlate = () => { placeAsk.at = 0; return refreshPlacePlate(); };   // e2e: ask now (the first ask waits 4 s for a fix)
    // ---- Your roads and a Sunday suggestion (panel round 1, D-1 and R-1; your_roads.js) ----------------------------------
    // The deck's first row names one real suggestion and its reason (a crew drive you're going to this week, the best road
    // near you that you haven't driven, this week's time attack loop, your best-scored road), else the loop as before; under it up to three of your own
    // roads, each a tap from being driven again. Unknown stays unknown: nothing found, nothing said.
    const YR = window.ApexYourRoads;
    const deckState = { all: [], dates: [], sugg: null, crew: null, attack: null, untried: null, untriedAt: -Infinity, untriedLat: null, untriedLon: null };
    const deckLong = (m) => ApexFormat.distance(m);                  // RA-3: one distance format everywhere
    async function refreshYourRoads() {
      if (!YR || !window.ApexAnalysis) return;
      let list = [];
      try { list = (await ApexAnalysis.job('summaries')).list || []; } catch (_) { list = []; }
      deckState.all = YR.roads(list, 50);
      deckState.dates = list.filter((x) => x && x.source === 'web-gps' && x.date_known !== false).map((x) => x.date);
      paintDeck();
    }
    function crewSoon(rows) {
      const now = Date.now(), soon = (Array.isArray(rows) ? rows : []).filter((e) => {
        const t = Date.parse(e && e.starts_at);
        return e && e.my_rsvp === 'going' && Number.isFinite(t) && t > now - 3600000 && t - now <= 7 * 86400000;
      }).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
      const was = deckState.crew ? deckState.crew.key : '', key = soon ? `${soon.id}|${soon.starts_at}` : '';
      deckState.crew = soon ? { key, title: soon.title, crew: soon.crew_name || null, at: Date.parse(soon.starts_at), lat: soon.meet_lat, lon: soon.meet_lon,
        label: soon.meet_name || soon.title, when: window.ApexCrewEvents ? ApexCrewEvents.timeText(soon.starts_at) : null } : null;
      if (was !== key) paintDeck();
    }
    const ROAD_GLYPH = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M12 37 C12 26 28 26 28 18 C28 10 16 10 16 3"/><circle cx="12" cy="37" r="2.4"/></svg>';
    // DA-1 / KE-2 (panel round 2): a row is two keys. Its body (the road's own shape, its name and reason) draws the road on
    // the map, fitted with you in view, and a second tap clears it; its key routes it, as the whole row did. A row with no
    // road to draw (the loop) is one action either way. `road`: { key, get: async () => ({ lat, lon }) | null } or null.
    function deckRow(title, why, key, label, onTap, road) {
      const row = document.createElement('div'), body = document.createElement('button'), go = document.createElement('button');
      const glyph = document.createElement('span'), span = document.createElement('span'), t = document.createElement('b'), w = document.createElement('small'), k = document.createElement('em');
      row.className = 'loop-suggest your-road split'; body.type = go.type = 'button'; body.className = 'ls-show'; go.className = 'ls-go';
      glyph.className = 'ls-glyph'; glyph.innerHTML = ROAD_GLYPH;
      t.textContent = title; w.textContent = why; k.textContent = key; span.append(t, w); body.append(glyph, span); go.append(k); row.append(body, go);
      go.setAttribute('aria-label', label); go.addEventListener('click', () => { clearDeckRoad(); onTap(); });
      if (road) { body.dataset.road = road.key; body.setAttribute('aria-label', `${title}: ${why}. Show it on the map.`); deckShow(body, glyph, road); }
      else { body.setAttribute('aria-label', label); body.addEventListener('click', onTap); }
      return row;
    }
    // ---- DA-1: the deck's roads drawn: each row's glyph is its road's shape (route_thumb.js), and its line on the map ----
    const LOOP_GLYPH = $('loopSuggestGlyph').innerHTML;              // the loop's own glyph, back when the suggestion has no road
    const deckShapes = new Map();                                      // key -> { lat, lon } (at most 300 points), or null
    const deckShape = async (road) => {
      if (deckShapes.has(road.key)) return deckShapes.get(road.key);
      let g = null;
      try { g = await road.get(); } catch (_) { g = null; }
      if (g && Array.isArray(g.lat) && g.lat.length >= 2) {
        const step = Math.max(1, Math.floor(g.lat.length / 300)), lat = [], lon = [];
        for (let i = 0; i < g.lat.length; i += step) if (Number.isFinite(g.lat[i]) && Number.isFinite(g.lon[i])) { lat.push(g.lat[i]); lon.push(g.lon[i]); }
        g = lat.length >= 2 ? { lat, lon } : null;
      } else g = null;
      deckShapes.set(road.key, g);
      return g;
    };
    function shapeGlyph(g) {
      const svg = window.ApexRouteThumb && g ? ApexRouteThumb.svg(g.lat, g.lon, { w: 40, h: 40, pad: 5, width: 2.4, line: 'currentColor', hi: 'currentColor', label: 'The road' }) : null;
      return svg ? svg.replace('<svg ', '<svg class="road-shape" aria-hidden="true" ') : null;
    }
    let deckRoadKey = null;
    function deckShow(body, glyph, road) {
      body.setAttribute('aria-pressed', String(deckRoadKey === road.key));
      deckShape(road).then((g) => { const svg = shapeGlyph(g); if (svg && glyph.isConnected) glyph.innerHTML = svg; });   // the road's real shape, once known
      body.addEventListener('click', async (e) => {
        e.stopPropagation();                                           // the road, not the row's key
        if (deckRoadKey === road.key) { clearDeckRoad(); return; }
        const g = await deckShape(road);
        if (!g) { toast('That road’s line isn’t on this phone.'); return; }
        drawDeckRoad(road.key, g);
      });
    }
    function drawDeckRoad(key, g) {
      if (!mapReady) return;
      const coords = g.lat.map((la, i) => [g.lon[i], la]);
      const data = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        { type: 'Feature', properties: { start: true }, geometry: { type: 'Point', coordinates: coords[0] } }] };
      if (map.getSource('apex-deckroad-src')) map.getSource('apex-deckroad-src').setData(data);
      else {
        map.addSource('apex-deckroad-src', { type: 'geojson', data });
        map.addLayer({ id: 'apex-deckroad', type: 'line', source: 'apex-deckroad-src', filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6], 'line-dasharray': [1.6, 1.2] } });
        map.addLayer({ id: 'apex-deckroad-start', type: 'circle', source: 'apex-deckroad-src', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-stroke-width': 2 } });
      }
      map.setPaintProperty('apex-deckroad', 'line-color', look.colors.route);
      map.setPaintProperty('apex-deckroad-start', 'circle-color', look.colors.route); map.setPaintProperty('apex-deckroad-start', 'circle-stroke-color', look.colors.routeCasing);
      for (const id of ['apex-deckroad', 'apex-deckroad-start']) map.setLayoutProperty(id, 'visibility', 'visible');
      deckRoadKey = key;
      document.querySelectorAll('.loop-suggest .ls-show[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      const shown = [...document.querySelectorAll('.loop-suggest .ls-show[aria-pressed]')].find((b) => b.dataset.road === key);
      if (shown) shown.setAttribute('aria-pressed', 'true');
      // the whole road and you, in the map the deck leaves
      let w = 180, e = -180, so = 90, n = -90;
      const add = (la, lo) => { w = Math.min(w, lo); e = Math.max(e, lo); so = Math.min(so, la); n = Math.max(n, la); };
      g.lat.forEach((la, i) => add(la, g.lon[i]));
      if (state.lastPosition) add(state.lastPosition.lat, state.lastPosition.lon);
      pauseFollow();
      const top = $('planPanel').getBoundingClientRect().top, mr = map.getContainer().getBoundingClientRect();
      fitInView([[w, so], [e, n]], Math.max(24, mr.bottom - top + 16));
    }
    function clearDeckRoad() {
      if (deckRoadKey == null) return;
      deckRoadKey = null;
      document.querySelectorAll('.loop-suggest .ls-show[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      if (mapReady && map.getLayer('apex-deckroad')) for (const id of ['apex-deckroad', 'apex-deckroad-start']) map.setLayoutProperty(id, 'visibility', 'none');
    }
    // the deck goes (a route, the plan sheet, a drive): its road goes with it
    new MutationObserver(() => { const a = $('app'); if (deckRoadKey != null && (!a.classList.contains('idle') || a.classList.contains('routed') || a.classList.contains('plan-open'))) clearDeckRoad(); })
      .observe($('app'), { attributes: true, attributeFilter: ['class'] });
    // where each row's road comes from: your drive on it (the Log's own track), or the stage the suggestion found in the tiles
    const driveRoad = (id) => ({ key: 'drive:' + id, get: async () => (await ApexAnalysis.job('memory', { track: id })).track });
    function paintDeck() {
      if (!YR) return;
      untriedNow();
      const sugg = YR.suggest({ crew: deckState.crew, attack: deckState.attack, untried: deckState.untried, mine: deckState.all, long: deckLong });
      deckState.sugg = sugg;
      paintLoopSuggest();
      // TestFlight 2026-11-05 ("takes up so much screen"): the suggestion and one row under it (it was two); the rest are a
      // tap away in Where to?, and a swipe down on the bar folds the deck to the bar alone (setDeckMin)
      const rows = YR.deck(sugg, deckState.all.slice(0, 3), 2).slice(1).map((row) => {
        if (row.kind === 'loop') {
          const b = document.querySelector('#loopDetents button[aria-pressed="true"]'), title = `Loop from here · ${b ? b.textContent : '45 mi'}`;
          return deckRow(title, 'On the twistiest roads nearby', 'Plan', `${title}, on the twistiest roads nearby. Plan it.`, () => { if (!loopBusy) $('findLoopBtn').click(); });
        }
        const r = row.r, why = YR.roadLine(r, deckLong);
        return deckRow(r.name, why, 'Plan', `${r.name}: ${why}. Plan it again.`, () => driveAgain(r.id, r.name), driveRoad(r.id));
      });
      $('yourRoads').replaceChildren(...rows);
      scheduleNudge();
    }
    // The suggested loop on the deck: the length you last picked on the loop dial; tapping it builds that loop. With a
    // suggestion (above) this row is the suggestion, its reason under it.
    // DA-1: the suggestion's road, when it has one to draw: the stage found in the tiles, or your best road's drive
    function suggestRoad(s) {
      if (s && s.kind === 'untried' && deckState.untried && deckState.untried.pick) { const st = deckState.untried.pick.s; return { key: 'stage:' + s.name, get: async () => st }; }
      if (s && s.kind === 'best' && s.id) return driveRoad(s.id);
      if (s && s.kind === 'attack' && deckState.attack) { const g = deckState.attack.geom; return { key: 'ta:' + s.key, get: async () => ({ lat: g.map((p) => p[0]), lon: g.map((p) => p[1]) }) }; }
      return null;
    }
    function paintLoopSuggest() {
      const s = deckState.sugg, road = suggestRoad(s), body = $('loopSuggestShow'), glyph = $('loopSuggestGlyph');
      body.dataset.road = road ? road.key : '';
      if (road) {
        body.setAttribute('aria-pressed', String(deckRoadKey === road.key));
        if (glyph.dataset.road !== road.key) { glyph.dataset.road = road.key; deckShape(road).then((g) => { const svg = shapeGlyph(g); if (svg && glyph.dataset.road === road.key) glyph.innerHTML = svg; }); }
      } else {
        body.removeAttribute('aria-pressed');
        if (glyph.dataset.road) { glyph.dataset.road = ''; glyph.innerHTML = LOOP_GLYPH; }
      }
      if (s) {
        $('loopSuggestTitle').textContent = s.title; $('loopSuggestWhy').textContent = s.reason; $('loopSuggestKey').textContent = 'Plan';   // finding 8: it plans; Start goes
        const label = `${s.title}. ${s.reason}. ${s.kind === 'crew' ? 'Directions to the meeting point.' : s.kind === 'attack' ? 'Directions to the start.' : 'Route it.'}`;
        $('loopSuggestGo').setAttribute('aria-label', label); body.setAttribute('aria-label', road ? `${s.title}. ${s.reason}. Show it on the map.` : label);
        return;
      }
      const b = document.querySelector('#loopDetents button[aria-pressed="true"]');
      $('loopSuggestTitle').textContent = `Loop from here · ${b ? b.textContent : '45 mi'}`;
      $('loopSuggestWhy').textContent = 'On the twistiest roads nearby'; $('loopSuggestKey').textContent = 'Plan';
      $('loopSuggestGo').setAttribute('aria-label', 'Plan a loop from here'); body.setAttribute('aria-label', 'Plan a loop from here');
    }
    // the suggestion's body: its road on the map when it has one, else what its key does
    $('loopSuggestShow').addEventListener('click', async (e) => {
      const road = suggestRoad(deckState.sugg);
      if (!road) return;                                               // bubbles to the row: the key's action
      e.stopPropagation();
      if (deckRoadKey === road.key) { clearDeckRoad(); return; }
      const g = await deckShape(road);
      if (!g) { toast('That road’s line isn’t on this phone.'); return; }
      drawDeckRoad(road.key, g);
    });
    $('loopSuggest').addEventListener('click', () => {
      clearDeckRoad();
      const s = deckState.sugg;
      if (s && s.kind === 'crew') { if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) routeToPlace({ label: (deckState.crew && deckState.crew.label) || s.name, lat: s.lat, lon: s.lon }); return; }
      if (s && s.kind === 'best') { driveAgain(s.id, s.name); return; }
      if (s && s.kind === 'attack') { routeToPlace({ label: s.name, lat: s.lat, lon: s.lon }); return; }
      if (s && s.kind === 'untried' && deckState.untried) { driveSuggested(deckState.untried); return; }
      if (!loopBusy) $('findLoopBtn').click();
    });
    // The best road near you that you haven't driven: Explore's stage finder (R-10) over its 30-minute reach, run once in the
    // background while the map is idle (again after 30 min, or 5 km on), named roads only. It reads the map's own tiles and
    // nothing else: no router is asked until you tap it, so the distance it gives is a straight line, said as "from here".
    async function findUntried() {
      const p = state.lastPosition;
      if (!YR || !p || !window.ApexStages || navigator.onLine === false || state.mode === 'live' || driveActive || loopBusy || power.low || document.hidden) return;
      const moved = deckState.untriedLat == null ? Infinity : Math.hypot((p.lat - deckState.untriedLat) * 111, (p.lon - deckState.untriedLon) * 111 * Math.cos(p.lat * Math.PI / 180));
      if (performance.now() - deckState.untriedAt < 30 * 60000 && moved < 5) return;
      deckState.untriedAt = performance.now(); deckState.untriedLat = p.lat; deckState.untriedLon = p.lon;
      const c = { lat: p.lat, lon: p.lon }, maxKm = Math.min(14, 30 / 60 * EXPLORE_KMH);
      const mine = new Set(deckState.all.map((r) => r.name.trim().toLowerCase()));
      const ends = (s) => [FunRoute.kmBetween(c, { lat: s.lat[0], lon: s.lon[0] }), FunRoute.kmBetween(c, { lat: s.lat[s.lat.length - 1], lon: s.lon[s.lon.length - 1] })];
      const inReach = (s) => Math.min(...ends(s)) <= maxKm;
      let found = null;
      try {
        const all = (await ApexStages.discover(c, maxKm, null, { names: inReach })).filter((x) => x.name && x.good > 0 && inReach(x) && !mine.has(roadLabel(x.name).trim().toLowerCase()));
        // our own tiles say which are neighbourhood streets or poor roads (route_ctx/graph.js, on the phone, no network);
        // with no tiles here nothing is known and the map's best stays the pick
        const looked = ownOn() && ownClient ? await stagesWithContext(all.slice(0, 12), 12, ['graph']) : all;
        const s = looked.find((x) => !x.notRoad);                     // best first
        if (s && state.mode !== 'live') {
          const [a, b] = ends(s), fwd = a <= b;
          found = { name: roadLabel(s.name), good: s.good, awayM: Math.min(a, b) * 1000, pick: { s, fwd }, here: c };
        }
      } catch (_) { found = null; }                                   // no tiles (offline): no suggestion, nothing said
      deckState.untried = found;
      paintDeck();
    }
    // the sky in one word now, the place plate's (place_plate.js), on the suggestion that names a road you haven't driven
    function untriedNow() { if (deckState.untried) deckState.untried.sky = placeAsk.data ? ApexPlacePlate.sky(placeAsk.data.code) : null; }
    setTimeout(() => { findUntried(); }, 15000); setInterval(() => { findUntried(); }, 5 * 60000);
    // One road, routed: from here to its near end, then through it (driveStage's way, without the Explore list).
    async function driveSuggested(u) {
      const p = u && u.pick;
      if (!p || loopBusy || optionBusy || state.mode === 'live' || $('planPanel').classList.contains('busy')) return;
      loopBusy = true;
      const ui = planBusy();
      try {
        ui.step('Routing…');
        const from = (await locate()) || u.here;
        const pts = ApexStages.waypoints(from, { legs: [{ s: p.s, fwd: p.fwd }] }).slice(0, -1);
        const [r] = await routePoints(pts);
        if (state.mode === 'live') return;
        const end = pts[pts.length - 1], t = await trackFromPolyline(r.coords, 'suggested', u.name);
        if (state.mode === 'live') return;
        Object.assign(t, { fun: funOf(t, r.turns), timeS: r.timeS, timeMarks: timeMarksOf(t, r), steps: stepsOf(t, r), unavoided: FunRoute.unavoided(avoid, r),
                           request: { from: null, to: { lat: end.lat, lon: end.lon }, via: pts.slice(1, -1).map(q => ({ lat: q.lat, lon: q.lon, shaping: true })) } });
        ownInstructLater(t, r);
        await buildRoute(null, 'suggested', u.name, t);
      } catch (_) { toast('Couldn\'t route to that road. Check signal and try again.'); }
      finally { loopBusy = false; ui.done(); }
    }
    // Drive it again (D-1): from here to where the drive started, then along it to where it ended, through points on its own
    // track (shaping points, so the router keeps to the road it took). From the deck, the drive's page and the end card.
    async function driveAgain(id, name) {
      if (!id || !YR || loopBusy || optionBusy || state.mode === 'live' || $('planPanel').classList.contains('busy')) return;
      loopBusy = true;
      const ui = planBusy();
      try {
        ui.step('Routing…');
        let d = null;
        try { d = (await ApexAnalysis.job('memory', { track: id })).track; } catch (_) { d = null; }
        if (!d || !Array.isArray(d.lat) || d.lat.length < 2) { toast('That drive isn’t on this phone any more.'); return; }
        const label = name || d.name || 'Your road', from = await locate();
        if (!from) { toast(NO_FIX); return; }
        const pts = YR.againPoints(from, d.lat, d.lon);
        const [r] = await routePoints(pts);
        if (state.mode === 'live') return;
        const end = pts[pts.length - 1], t = await trackFromPolyline(r.coords, 'again', label);
        if (state.mode === 'live') return;
        Object.assign(t, { fun: funOf(t, r.turns), timeS: r.timeS, timeMarks: timeMarksOf(t, r), steps: stepsOf(t, r), unavoided: FunRoute.unavoided(avoid, r),
                           request: { from: null, to: { lat: end.lat, lon: end.lon }, via: pts.slice(1, -1).map(q => ({ lat: q.lat, lon: q.lon, shaping: !!q.shaping })) } });
        ownInstructLater(t, r);
        await buildRoute(null, 'again', label, t);
      } catch (_) { toast('Couldn\'t route that drive. Check signal and try again.'); }
      finally { loopBusy = false; ui.done(); }
    }
    // DA-4 / RA-4 (panel round 2): a road someone sent (road_link.js): its line, its name, nothing of the drive. It opens as a
    // route card: from here through the road when the phone knows where it is, else the road alone.
    async function openRoadLink(token) {
      const road = window.ApexRoadLink ? ApexRoadLink.decode(token) : null;
      if (!road) { toast('That road link is incomplete. Ask for it again.'); return; }
      if (loopBusy || optionBusy || state.mode === 'live') { toast('Open the road link again when the drive is over.'); return; }
      loopBusy = true;
      const ui = planBusy();
      try {
        ui.step('Routing…');
        const label = road.name || 'A road you were sent', from = await locate().catch(() => null);
        const along = road.pts.map((p, k) => ({ lat: p.lat, lon: p.lon, shaping: k > 0 && k < road.pts.length - 1 }));
        const pts = from ? [{ lat: from.lat, lon: from.lon }, ...along] : along;
        const [r] = await routePoints(pts);
        if (state.mode === 'live') return;
        const end = pts[pts.length - 1], t = await trackFromPolyline(r.coords, 'road', label);
        if (state.mode === 'live') return;
        Object.assign(t, { fun: funOf(t, r.turns), timeS: r.timeS, timeMarks: timeMarksOf(t, r), steps: stepsOf(t, r), unavoided: FunRoute.unavoided(avoid, r),
                           request: { from: from ? null : { lat: pts[0].lat, lon: pts[0].lon }, to: { lat: end.lat, lon: end.lon }, via: pts.slice(1, -1).map(q => ({ lat: q.lat, lon: q.lon, shaping: !!q.shaping })) } });
        ownInstructLater(t, r);
        await buildRoute(null, 'road', label, t);
      } catch (_) { toast('Couldn\'t route that road. Check signal and try again.'); }
      finally { loopBusy = false; ui.done(); }
    }
    // The reminder (R-1): one local notification, off until you turn it on (Garage > Reminder), at most once a week, the
    // evening before your usual day (or a crew drive you're going to), naming the deck's suggestion. Scheduled by the shell
    // (ApexNavApp.swift ApexNudge); the page only says when and what. Nothing about it leaves the phone.
    const NUDGE_KEY = 'apex.nudge';
    const nudgeShell = () => (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex) || null;
    function nudgeLoad() { try { return JSON.parse(localStorage.getItem(NUDGE_KEY) || '{}') || {}; } catch (_) { return {}; } }
    function nudgeSave(st) { try { localStorage.setItem(NUDGE_KEY, JSON.stringify(st)); } catch (_) {} }
    function scheduleNudge() {
      const native = nudgeShell();
      if (!YR || !native) { paintNudgeState(null); return; }
      const st = nudgeLoad(), now = Date.now();
      if (Number.isFinite(st.pending) && st.pending <= now) { st.last = st.pending; st.pending = null; st.key = ''; }   // it went
      let at = null, text = null;
      if (state.toggles.nudge) {
        const sugg = deckState.sugg, day = YR.usualDay(deckState.dates);
        at = YR.nudgeAt({ now, day, crewAt: sugg && sugg.kind === 'crew' ? sugg.at : null, lastAt: st.last });
        text = at ? YR.nudgeText(sugg, day, at) : null;
      }
      const key = at ? `${at}|${text.title}|${text.body}` : '';
      if (key !== (st.key || '')) {
        try { native.postMessage(at ? { cmd: 'nudge', op: 'set', at, title: text.title, body: text.body } : { cmd: 'nudge', op: 'off' }); } catch (_) {}
        st.pending = at; st.key = key;
      }
      nudgeSave(st);
      paintNudgeState(at ? { at, text } : null);
    }
    function paintNudgeState(next) {
      const n = $('nudgeState'); if (!n) return;
      if (!nudgeShell()) { n.textContent = 'Reminders come from the Vetta app on iPhone.'; return; }
      if (!state.toggles.nudge) { n.textContent = 'Off.'; return; }
      if (!next) { n.textContent = 'On. The first one waits until Vetta knows your usual day: two drives on the same day of the week.'; return; }
      const d = new Date(next.at);
      n.textContent = `Next: ${d.toLocaleDateString([], { weekday: 'long' })} ${ApexFormat.clock12(d.getHours(), d.getMinutes())}, "${next.text.title}".`;
    }
    function nudgeSwitched() {
      const native = nudgeShell();
      if (state.toggles.nudge && !native) { state.toggles.nudge = false; paintSwitches(); toast('Reminders need the Vetta app on iPhone.'); }
      else if (state.toggles.nudge) { try { native.postMessage({ cmd: 'nudge', op: 'allow' }); } catch (_) {} }   // iOS asks once, now
      scheduleNudge();
    }
    function nudgeAnswered(granted) {
      if (granted) { scheduleNudge(); return; }
      state.toggles.nudge = false; paintSwitches(); savePrefs(); scheduleNudge();
      // Only the shell answers here, so the key can open Vetta's own page in the iPhone's Settings (the `openSettings` the
      // "Location is off" sheet uses).
      toast('Notifications are off for Vetta. Turn them on in Settings, then here.', { label: 'Settings', onClick: () => { try { nudgeShell().postMessage({ cmd: 'openSettings' }); } catch (_) {} } });
    }
    // Push notifications (ApexPush.swift, backend/src/push.ts, docs/SOCIAL.md 2.12): Garage > Notifications, off until turned
    // on, and only then does iOS ask. The shell hands the phone's token here and the page gives it to the Worker with its own
    // session; the token is kept here only so this phone can take it back (switch off, Sign out). Nothing during a drive.
    // (declarations, not consts: renderAccount and Sign out can run before this part of the page has)
    function pushShell() { return (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex) || null; }
    function pushKept() { try { return localStorage.getItem('apex.pushToken') || ''; } catch (_) { return ''; } }
    function pushKeep(t) { try { if (t) localStorage.setItem('apex.pushToken', t); else localStorage.removeItem('apex.pushToken'); } catch (_) {} }
    function pushMember() { return !!(accountMe && accountMe.member); }
    function pushSwitched() {
      const native = pushShell();
      if (state.toggles.push && !native) { state.toggles.push = false; paintSwitches(); toast('Notifications come from the Vetta app on iPhone.'); }
      else if (state.toggles.push && !pushMember()) { state.toggles.push = false; paintSwitches(); askSignIn('hear from your friends'); }
      else if (state.toggles.push) { try { native.postMessage({ cmd: 'push', op: 'allow' }); } catch (_) {} }   // iOS asks once, now
      else pushForgetHere();
      paintPushState();
    }
    async function pushForgetHere() {
      const t = pushKept(); if (!t) return;
      pushKeep('');
      try { await apiCall('DELETE', '/api/push/token', { token: t }); } catch (_) {}
    }
    function pushAnswered(granted) {
      if (granted) { paintPushState(); return; }   // the token follows from the shell
      state.toggles.push = false; paintSwitches(); savePrefs(); paintPushState();
      toast('Notifications are off for Vetta. Turn them on in Settings, then here.', { label: 'Settings', onClick: () => { try { pushShell().postMessage({ cmd: 'openSettings' }); } catch (_) {} } });
    }
    async function pushTokenIn(msg) {
      if (!state.toggles.push || !pushMember() || typeof msg.token !== 'string') return;
      try { const r = await apiCall('POST', '/api/push/token', { token: msg.token, sandbox: !!msg.sandbox }); if (r.ok) pushKeep(msg.token); } catch (_) {}
    }
    // a drive started (on) or ended: the Worker holds every push for this person until it ends (three hours at most)
    function pushQuiet(on) { if (state.toggles.push && pushMember() && pushKept()) apiCall('PUT', '/api/push/quiet', { on }).catch(() => {}); }
    function paintPushState() {
      const n = $('pushState'); if (!n) return;
      n.textContent = !pushShell() ? 'Notifications come from the Vetta app on iPhone.' : state.toggles.push ? 'On. Nothing comes while you drive.' : 'Off.';
      paintPushKinds();
    }
    // each kind its own switch, under the main one while it is on (the server keeps which are off: GET/PUT /api/push/kinds)
    const PUSH_KINDS = [['friends', 'Friend requests'], ['kudos', 'Kudos'], ['comments', 'Comments and mentions'], ['duels', 'Duels'], ['crews', 'Crew drives']];
    let pushOff = null;
    function paintPushKinds() {
      const box = $('pushKinds'); if (!box) return;
      const show = !!(pushShell() && state.toggles.push && pushMember());
      box.hidden = !show || !pushOff;
      if (!show) return;
      if (!pushOff) { pushOff = []; apiCall('GET', '/api/push/kinds').then(jsonOf).then((r) => { pushOff = r && Array.isArray(r.off) ? r.off : []; paintPushKinds(); }).catch(() => { pushOff = null; }); return; }
      box.replaceChildren(...PUSH_KINDS.map(([k, label]) => {
        const on = !pushOff.includes(k), b = el('button', { type: 'button', className: `sw${on ? ' on' : ''}`, role: 'switch' }, el('i'), el('span', { textContent: label }));
        b.setAttribute('aria-checked', String(on));
        b.addEventListener('click', async () => {
          const was = pushOff, next = on ? [...pushOff, k] : pushOff.filter((x) => x !== k);
          pushOff = next; paintPushKinds();
          const r = await apiCall('PUT', '/api/push/kinds', { off: next }).catch(() => null);
          if (!r || !r.ok) { pushOff = was; paintPushKinds(); toast('Couldn’t change it. Check signal.'); }
        });
        return b;
      }));
    }
    // after your first post: one offer to hear about its kudos and comments (never again once seen)
    function pushOffer() {
      if (!pushShell() || state.toggles.push || !pushMember()) return;
      try { if (localStorage.getItem('apex.pushOffered') === '1') return; localStorage.setItem('apex.pushOffered', '1'); } catch (_) { return; }
      setTimeout(() => toast('Hear when friends give it kudos?', { label: 'Turn on', ms: 8000, onClick: () => { state.toggles.push = true; paintSwitches(); savePrefs(); pushSwitched(); } }), 2600);
    }
    // This week's featured time attack loop in your area (ta_fixed.ts) as the deck's suggestion: first after a crew drive when you
    // entered it, else after the road you haven't driven. Members only, with the drive-today check (every 10 min); the server
    // is sent the middle of your quarter-degree area, never where you are (time_attack.js areaPoint). No loop, nothing said.
    function attackIs(a) {
      const was = deckState.attack ? `${deckState.attack.key}|${deckState.attack.entered}|${deckState.attack.place}|${deckState.attack.times}|${deckState.attack.left}` : '';
      deckState.attack = a;
      if (was !== (a ? `${a.key}|${a.entered}|${a.place}|${a.times}|${a.left}` : '')) paintDeck();
    }
    async function refreshAttack() {
      const p = state.lastPosition;
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;   // no position yet: what was known stays
      const at = { lat: Math.floor(p.lat / 0.25) * 0.25 + 0.125, lon: Math.floor(p.lon / 0.25) * 0.25 + 0.125 };   // time_attack.js areaPoint
      const t = await apiCall('GET', `/api/ta?lat=${at.lat}&lon=${at.lon}`).then((r) => (r && r.ok ? jsonOf(r) : null)).catch(() => null);
      if (t) attackIs(YR ? YR.attackFrom(t) : null);
    }
    // The morning of a crew drive you said you're going to (REVIEW.md roadmap 21, crew_events.js todayDrive): from 4 AM until an
    // hour after it starts, the idle map offers directions to the meeting point instead of the loop. Members only, every 10 min.
    let driveTodayEvent = null;
    async function refreshDriveToday() {
      let e = null;
      if (accountMe && accountMe.member && window.ApexCrewEvents && navigator.onLine !== false) {
        const rows = await apiCall('GET', '/api/events').then(jsonOf).catch(() => null);
        e = ApexCrewEvents.todayDrive(rows);
        crewSoon(rows);                                                // panel R-1: a drive this week is the deck's suggestion
        await refreshAttack();
      } else { crewSoon(null); attackIs(null); }
      driveTodayEvent = e;
      $('driveToday').hidden = !e;
      $('app').classList.toggle('drive-today-on', !!e);
      if (!e) return;
      const d = ApexCrewPage ? ApexCrewPage.dateBlock(e.starts_at) : { day: '', mon: '' };
      $('driveTodayDay').textContent = d.day; $('driveTodayMon').textContent = d.mon;
      $('driveTodayTitle').textContent = `${e.title} \u00b7 ${new Date(e.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      $('driveTodayMeta').textContent = [`Meet at ${e.meet_name || 'the pin'}`, `${e.going.length} going`, ApexCrewEvents.rolesLine(e)].join(' \u00b7 ');
      $('driveToday').setAttribute('aria-label', `Today: ${e.title}. Directions to the meeting point.`);
    }
    $('driveToday').addEventListener('click', () => { const e = driveTodayEvent; if (e) routeToPlace({ label: e.meet_name || e.title, lat: e.meet_lat, lon: e.meet_lon }); });
    setTimeout(refreshDriveToday, 5000); setInterval(refreshDriveToday, 10 * 60000);
    setTimeout(() => { if (!deckState.attack && accountMe && accountMe.member && navigator.onLine !== false) refreshAttack().catch(() => {}); }, 40000);   // the position comes late
    document.querySelectorAll('#loopDetents button').forEach(b => b.addEventListener('click', paintDeck));
    paintLoopSuggest();
    // ---- Look and voice: the theme picker (REVIEW.md 4.5) ---------------------------------------------------------------
    // A card per theme: a live preview of its strip and speed in its own tokens, its name, two lines, its co-driver with one
    // sample line and a Hear key. Roadbook is free; a Pro theme can be tried on the demo replay for 10 minutes, then the
    // look comes back and one line says what it is (pro.js: Pro isn't on sale yet, and says so).
    const proFlags = () => (window.ApexFlags ? { pro: ApexFlags.on('pro', false), proOnSale: ApexFlags.on('proOnSale', false) } : {});   // both off unless the server turns them on
    const themeAllowed = (id) => { const t = Themes.THEMES[id]; return !!t && (!t.pro || ApexPro.allowed(`theme_${id}`, localStorage, proFlags())); };
    let themeTrial = null;                                            // { id, was, timer } while a Pro theme is being tried
    function useTheme(id) { state.theme = id; savePrefs(); applyTheme(); renderThemePicker(); }
    function paintTrial() {
      const p = $('trialPlate'); if (!p) return;
      p.hidden = !themeTrial;
      if (!themeTrial) return;
      const left = Math.max(0, themeTrial.ends - Date.now()), m = Math.floor(left / 60000), sec = Math.floor(left / 1000) % 60;
      $('trialText').textContent = `${Themes.THEMES[themeTrial.id].label} · ${m}:${String(sec).padStart(2, '0')} left`;
      const watching = !!(replayOn && track && track.demo);
      if ($('trialWatch').hidden !== watching) $('trialWatch').hidden = $('trialWatchSep').hidden = watching;
    }
    function endThemeTrial(say) {
      if (!themeTrial) return;
      clearTimeout(themeTrial.timer); clearInterval(themeTrial.tick);
      const { id, was } = themeTrial; themeTrial = null;
      useTheme(was); paintTrial();
      if (say) toast(ApexPro.line(`theme_${id}`, proFlags()) || '', { ms: 8000 });
    }
    function tryTheme(id) {
      if (themeTrial) endThemeTrial(false);
      themeTrial = { id, was: themeAllowed(state.theme) ? state.theme : 'roadbook', ends: Date.now() + 10 * 60000,
        timer: setTimeout(() => endThemeTrial(true), 10 * 60000), tick: setInterval(paintTrial, 1000) };
      useTheme(id); closeSheet();
      // F-09 (REVIEW_FEEL): the theme is on in the next frame; the demo drive (1.8 MB of script and a replay) loads only when
      // asked for, from the plate's Watch a replay, never as part of trying the look
      paintTrial();
    }
    function themePreview(t) {
      const c = t.day, box = document.createElement('div');
      box.className = `theme-preview tp-${t.id}`;
      for (const [k, v] of Object.entries(c)) box.style.setProperty(`--${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`, v);
      box.style.setProperty('--font-ui', t.fonts.ui); box.style.setProperty('--font-num', t.fonts.num);
      fillPreview(box, t);
      return box;
    }
    // HE-3 (panel round 2): the card draws a real strip head in the driver's words (vocabulary.js sampleStrip: plainCall or
    // the rally call through the strip's own lockup), with its distance, never a hard-coded "LEFT 4 · TIGHTENS" over 42 MPH
    const vocabDeps = () => ({ plain: window.ApexPlainNotes, units: ApexUnits, paceNoteText: Core.paceNoteText, lockup: Inst.lockup, voiceLines: window.ApexVoiceLines });
    const cardMode = () => (document.documentElement.dataset.mode === 'night' ? 'night' : 'day');
    function fillPreview(box, t) {
      const c = t.day, st = window.ApexVocabulary && ApexVocabulary.sampleStrip(state.noteWords, vocabDeps());
      box._words = state.noteWords;
      if (t.car && t.car.dial && t.car.meter) {
        // a car's own theme: its card is the car's cluster, parked (needles at rest: no reading is shown), and the car from
        // above in its paint, drawn in the mode the page is in (orange-lit black faces at night, as the car)
        const m = cardMode(), cm = t[m];
        box._mode = m;
        box.classList.add('tp-car');
        for (const [k, v] of Object.entries(cm)) box.style.setProperty(`--${k.replace(/[A-Z]/g, (x) => '-' + x.toLowerCase())}`, v);
        for (const [k, v] of [['--car-needle', t.car.needle && t.car.needle[m]], ['--car-ring', t.car.ring && t.car.ring[m]], ['--car-disc', t.car.disc && t.car.disc[m]],
          ['--car-lamp', t.car.lamp && t.car.lamp[m]], ['--car-lcd', t.car.lcd && t.car.lcd[m]], ['--car-hub', t.car.hub && t.car.hub[m]], ['--car-lcd-ink', t.car.lcdInk && t.car.lcdInk[m]], ['--font-dial', t.fonts.dial]]) if (v) box.style.setProperty(k, v);
        box.dataset.mode = m;
        if (t.car.finish) box.dataset.finish = t.car.finish;
        box.replaceChildren();
        for (const slot of ['dial', 'meter']) { const g = el('div', { className: 'tp-g' }); box.append(g); Inst.carGauge(g, t.car[slot], slot)({}); }
        const sil = el('span', { className: 'tp-silhouette' }); sil.innerHTML = Themes.carSVG(t, cm.panelInk, 96, 40, { rotate: true }); box.append(sil);
        return;
      }
      if (!st) { box.innerHTML = ''; return; }
      box.innerHTML = `<span class="tp-tulip">${Inst.tulipSVG(st.note, c.panelInk, c.accent)}</span><span class="tp-call"><b></b><i></i></span><span class="tp-speed"><b></b><small></small></span>`;
      box.querySelector('.tp-call b').textContent = st.head.toUpperCase();
      box.querySelector('.tp-call i').textContent = st.tail.map((x) => x.text.toUpperCase()).join(' \u00b7 ');
      box.querySelector('.tp-speed b').textContent = st.dist.n; box.querySelector('.tp-speed small').textContent = st.dist.u;
    }
    // F-11 (REVIEW_FEEL): the cards are built once; a theme change or a trial only updates which one is in use and what its
    // key says (it used to rebuild every card, previews and all, on each change)
    const themeCards = new Map();
    function renderThemePicker() {
      const box = $('themeCards'); if (!box) return;
      if (themeCards.size !== Object.keys(Themes.THEMES).length) {
        themeCards.clear();
        box.replaceChildren(...Object.values(Themes.THEMES).map((t) => {
          const card = el('div', { className: 'theme-card' });
          const ok = () => themeAllowed(t.id);
          const pick = () => (ok() ? useTheme(t.id) : tryTheme(t.id));
          // HE-3 (panel round 2): the card quotes what this voice really says in the driver's words: the sample call from the
          // call grammar (vocabulary.js sampleQuote) and one of the pack's own sign-offs; Hear says the call as a drive does
          // and then plays the sign-off's clip
          const line = () => (t.voice && window.ApexVocabulary && ApexVocabulary.sampleQuote(t.voice.id, state.noteWords, vocabDeps())) || null;
          const hear = btn('Hear', () => { const l = line(); if (l) hearSample(t.voice.id, l); else hearPack(t.voice && t.voice.id, 'Notes ready.', 'sys:test'); }, 'ink-btn tc-hear');
          hear.setAttribute('aria-label', `Hear ${t.voice ? t.voice.name : t.label}`);
          // U-69: the card's preview is the theme drawn at 300 px, and touching it switches, as the Use key does. A pointer
          // shortcut only: the Use key stays the one control a screen reader or keyboard meets.
          const preview = themePreview(t);
          preview.setAttribute('aria-hidden', 'true');
          preview.addEventListener('click', () => { if (preview.classList.contains('tc-pick')) pick(); });
          // U-69: the key keeps its one word; its name says which card, so a screen reader (and the review recording) can
          // tell three "Use" keys apart
          const inUseTag = el('span', { className: 'tc-inuse', textContent: 'In use' }), key = btn('Use', pick, 'ink-btn');
          const quote = document.createTextNode('');
          card.append(preview,
            el('div', { className: 'tc-head' }, el('b', { textContent: t.label }), ...(t.pro ? [el('span', { className: 'tc-pro', textContent: 'PRO' })] : t.granted ? [el('span', { className: 'tc-pro', textContent: 'PRIVATE' })] : []), key),
            // TestFlight 2026-11-12 (the owner: "walls of text"): the look shows itself in its preview; the card names its voice and Hear says it
            el('div', { className: 'tc-voice' }, el('p', {}, el('b', { textContent: t.voice ? t.voice.name : '--' }), quote), hear));
          themeCards.set(t.id, { t, card, preview, key, inUseTag, ok, quote, line });
          return card;
        }));
      }
      for (const { t, card, preview, key, inUseTag, ok, quote } of themeCards.values()) {
        const allowed = ok(), inUse = state.theme === t.id && !themeTrial;
        if (preview._words !== state.noteWords || (t.car && preview._mode !== cardMode())) fillPreview(preview, t);   // the words changed: the strip head follows
        const q = t.voice ? ' · suggested voice' : '';
        if (quote.data !== q) quote.data = q;
        card.classList.toggle('in-use', state.theme === t.id);
        preview.classList.toggle('tc-pick', !inUse);
        key.textContent = allowed ? 'Use' : 'Try it';
        key.setAttribute('aria-label', `${allowed ? 'Use' : 'Try'} ${t.label}`);
        if (inUse && key.isConnected) key.replaceWith(inUseTag);
        else if (!inUse && inUseTag.isConnected) inUseTag.replaceWith(key);
      }
      shelveLooks();
    }
    // On a phone the looks stand on a shelf you turn sideways (index.html .theme-cards): it opens on the look in use, and
    // turns to it when the look changes somewhere else. Never while a finger is turning it: the card you chose is in view.
    // Native speed (2026-11-13): measured only on the Garage; at boot its read forced a layout of the closed sheet (25 ms at
    // 4x CPU). showView turns the shelf when the Garage opens.
    function shelveLooks() {
      const box = $('themeCards'), cur = themeCards.get(state.theme);
      if (view !== 'garage') return;
      if (!box || !cur || box._at === state.theme || box.scrollWidth <= box.clientWidth + 4) return;
      box._at = state.theme;
      box.scrollLeft = cur.card.offsetLeft - box.firstElementChild.offsetLeft;
    }
    // a Pro theme without Pro (a shared phone, Pro lapsed) goes back to the road book, never silently kept
    if (!themeAllowed(state.theme)) { state.theme = 'roadbook'; savePrefs(); applyTheme(); }
    renderThemePicker();
    // Private themes (migration 0044): /api/me lists the ones granted to this account, with their looks (themes.js grant()).
    // Signed out, another account, or a grant taken away: they leave the picker, and a look in use falls back to the road book.
    function applyThemeGrants(me) {
      if (!me || typeof me.signed_in !== 'boolean') return;           // offline or an error page: keep what the phone knew
      if (!Themes.grant(me.signed_in && Array.isArray(me.themes) ? me.themes : [], window.ApexThemeContract)) return;
      if (themeTrial && !Themes.THEMES[themeTrial.was]) themeTrial.was = 'roadbook';
      themeCards.clear();
      if (!Themes.THEMES[state.theme]) { state.theme = 'roadbook'; savePrefs(); applyTheme(); }
      renderThemePicker();
    }
    // Long help in the Garage folds under "How this works" (REVIEW.md 1.2, Settings): the control first, the essay on demand.
    document.querySelectorAll('[data-panel~="garage"] > p.note').forEach((p) => {   // on the page and in the gear's sheets
      if (p.id || p.textContent.trim().length < 140) return;                // short notes and live status lines stay as they are
      const d = el('details', { className: 'how' }, el('summary', { textContent: 'How this works' }));
      p.replaceWith(d); d.append(p);
    });
    // Import a drive log (moved here from the Log, REVIEW.md 1.2): a Vetta .csv lands in the Log like any drive.
    $('importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const d = ApexRecording.parse(Core, await file.text(), file.name);
        // IDEAS U-04: a file name or a date names it only until the map's tiles say which road carried it
        if (window.ApexRoadNames && window.ApexStages && ApexRoadNames.isStandInName(d.name, file.name)) {
          try {
            const road = ApexRoadNames.roadOfTrack(await RouteLoading.optional(ApexStages.namesAlong(d), 8000) || [], d);
            if (road) d.name = road;
          } catch (_) { /* no tiles: it keeps its name */ }
        }
        await ApexRecording.store(d); await refreshSavedDrives();
        toast(`${(window.ApexFormat ? ApexFormat.driveName(d.name) : d.name) || file.name} is in your Log.`, { label: 'Open', href: `analysis.html?tab=drive&drive=${encodeURIComponent(d.id)}` });
      } catch (err) { toast(/^missing column/.test(err.message) ? `Couldn't import ${file.name}. It isn't a Vetta drive log.` : `Couldn't import ${file.name}. The file may be damaged.`); }
      e.target.value = '';
    });
    document.querySelector('.tab[data-view="garage"]') && document.querySelector('.tab[data-view="garage"]').addEventListener('click', renderMyData);

    // Privacy zones (Settings): a circle at where you are or at the map's centre; remove any. Phone only.
    let zoneR = 500;
    function renderZones() {
      document.querySelectorAll('#zoneRadius [data-zone-r]').forEach(b => { b.classList.toggle('on', Number(b.dataset.zoneR) === zoneR); b.textContent = ApexUnits.size(Number(b.dataset.zoneR)); });   // in your units (it said metres to a driver in miles)
      const list = $('zoneList'); list.innerHTML = '';
      if (!privacyZones.length) { list.append(el('p', { className: 'note', textContent: 'No zones yet.' })); return; }
      for (const z of privacyZones) {
        list.append(el('div', { className: 'row' }, el('span', { textContent: `${z.name} · ${ApexUnits.size(z.r)}` }),
          btn('Remove', () => { privacyZones = ApexPrivacyZones.remove(privacyZones, z.id); ApexPrivacyZones.save(localStorage, privacyZones); renderZones(); paintDriveStat(); zonesChanged(); }, 'linkbtn')));
      }
    }
    // friends on the map keeps a copy of the zones on the server: it goes up now, not at the next change of who sees you
    const zonesChanged = () => { if (friendsMap && accountMe && accountMe.member) friendsMap.syncZones().catch(() => {}); };
    async function addZone(p) {
      const name = await ApexConfirm.prompt('Name this place', { action: 'Add zone', value: privacyZones.length ? '' : 'Home', placeholder: 'Home, Work', maxLength: 40 });
      if (name === null) return;
      const next = ApexPrivacyZones.add(privacyZones, { lat: p.lat, lon: p.lon, r: zoneR, name });
      if (!next) { toast(`Up to ${ApexPrivacyZones.MAX_ZONES} zones.`); return; }
      privacyZones = next; ApexPrivacyZones.save(localStorage, privacyZones); renderZones(); paintDriveStat(); zonesChanged();
      toast(`${privacyZones.at(-1).name}: nothing is recorded or shared within ${ApexUnits.size(zoneR)}.`);
    }
    document.querySelectorAll('#zoneRadius [data-zone-r]').forEach(b => b.addEventListener('click', () => { zoneR = Number(b.dataset.zoneR); renderZones(); }));
    $('zoneHereBtn').addEventListener('click', async () => { const p = await locate(); if (!p) { toast(NO_FIX); return; } addZone(p); });
    $('zoneMapBtn').addEventListener('click', () => { const c = map.getCenter(); addZone({ lat: c.lat, lon: c.lng }); });
    renderZones();
    // Note words (plain_notes.js, IDEAS V-02)
    function renderNoteWords() {
      document.querySelectorAll('#noteWordsList [data-words]').forEach(b => { const on = b.dataset.words === state.noteWords; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      // SO-1: the example is the call grammar's own output (vocabulary.js wordsExample), never a typed sentence
      $('noteWordsNote').textContent = window.ApexVocabulary ? ApexVocabulary.wordsExample(state.noteWords, vocabDeps()) : '';
    }
    document.querySelectorAll('#noteWordsList [data-words]').forEach(b => b.addEventListener('click', () => {
      state.noteWords = b.dataset.words; savePrefs(); renderNoteWords(); renderThemePicker(); render(true);
      if (track && track.kind === 'route' && car.route) carRoute(track);   // M-3: the car's plates in the new words
      say((window.ApexVocabulary && ApexVocabulary.sampleCall(state.noteWords, vocabDeps())) || '', true);   // the example, said
    }));
    renderNoteWords();
    $('hlOpenBtn').addEventListener('click', async () => {
      const p = await locate();
      if (!p) { toast(NO_FIX); return; }
      openHighlightDialog(p);
    });
    $('hlCancelBtn').addEventListener('click', closeHighlightDialog);
    onBackdrop($('hlOverlay'), () => closeHighlightDialog());
    $('hlAddBtn').addEventListener('click', async () => {
      if (!highlightPoint) return;
      let name = $('hlName').value.trim();
      // While moving there is no keyboard: an unnamed spot is named by the time.
      if (!name && document.body.classList.contains('moving')) name = `Spot ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      if (!name) { toast('Name the spot first.'); $('hlName').focus(); return; }
      const p = highlightPoint;
      const id = String(Date.now()), photo = pendingPhoto; pendingPhoto = null;
      let kept = false;
      if (photo) { try { await ApexSpotPhotos.put(id, photo); kept = true; } catch (_) { toast('The photo couldn\'t be kept (storage full?). The spot is saved without it.'); } }
      saveHighlights(loadHighlights().concat({ id, name: name.slice(0, 60), lat: p.lat, lon: p.lon, rating: highlightRating, category: highlightCategory, ...(kept ? { photo: true } : {}) }));
      closeHighlightDialog(); renderHighlights(); toast(`Spot saved: ${name}.`);
    });

    // A theme suggests a voice (REVIEW.md 4.4, roadmap 18): Roadbook's Marguerite, Tapedeck's Kit, Billet's Hale, and each
    // private theme's own. The driver can pick any pack in the Garage (Look and voice: data-pack, one home), with any theme,
    // and that choice stays across theme changes; Suggested goes back to the look's. A pack is used whenever its bank is on
    // the phone, the phone's own voice only when it isn't (or for words no bank has). (bankVoices is declared with the state.)
    function themeVoice() {
      const want = state.voicePick || (look && look.theme && look.theme.voice ? look.theme.voice.id : null);
      if (want && bankVoices.some(v => v.id === want)) { state.voiceId = want; state.voiceStyle = 'codriver'; }
      else if (!bankVoices.some(v => v.id === state.voiceId)) { state.voiceId = 'device'; state.voiceStyle = 'codriver'; }
    }
    function renderVoiceList() { themeVoice(); }
    function packName(id) { const v = bankVoices.find((x) => x.id === id); return v ? v.name : id.charAt(0).toUpperCase() + id.slice(1); }
    document.querySelectorAll('[data-pack]').forEach((b) => b.addEventListener('click', () => {
      state.voicePick = b.dataset.pack === 'look' ? null : b.dataset.pack;
      themeVoice(); savePrefs(); paintSwitches();
      if (window.ApexVoice && state.voiceId !== 'device') ApexVoice.load(state.voiceId).catch(() => {});
    }));
    // Key sounds (REVIEW.md 4.2): the theme's own click on its keys; off in Garage > Co-driver
    document.addEventListener('pointerdown', (e) => {
      const k = e.target.closest && e.target.closest('.key, .ink-btn, .rec-key, .btn-start, .map-key, .find-key, .switch > button, .detents > button, .stamps > button');
      if (!k || state.toggles.keys === false || !window.ApexThemeSounds || !window.ApexVoice) return;
      try { ApexThemeSounds.play(ApexVoice.unlock(), ApexThemeSounds.recipe(state.theme, 'key', Themes.get(state.theme).sounds)); } catch (_) {}
    }, { passive: true });
    // Hear on a theme card: that pack's own sample line, then back to the voice in use
    // HE-3: a theme card's sample as a drive says it: the call (plain words in the phone's voice, rally notes from the pack's
    // clips when the bank has them), then the pack's sign-off clip once the call has been said
    async function hearSample(id, l) {
      const chain = state.noteWords === 'plain' ? null : [ApexVocabulary.SAMPLE[0]];
      if (!window.ApexVoice || !bankVoices.some(v => v.id === id)) { say(l.text, true); return; }
      ApexVoice.unlock();
      try {
        await ApexVoice.load(id);
        let ok = false;
        if (chain) ok = await ApexVoice.play([...ApexVoice.tokensFor(chain), l.token]);
        if (!ok) {
          say(l.call, true);
          for (let i = 0; i < 100 && (speech.busy || speech.queue.size); i++) await new Promise((r) => setTimeout(r, 100));
          if (!(await ApexVoice.play([l.token]))) say(l.signOff, true);
        }
      } catch (_) { say(l.text, true); }
      try { if (state.voiceId !== 'device') await ApexVoice.load(state.voiceId); } catch (_) {}
    }
    async function hearPack(id, fallback, token = 'sys:sample') {
      if (!window.ApexVoice || !bankVoices.some(v => v.id === id)) { say(fallback, true); return; }
      ApexVoice.unlock();
      try { await ApexVoice.load(id); if (!(await ApexVoice.play([token]))) say(fallback, true); } catch (_) { say(fallback, true); }
      try { if (state.voiceId !== 'device') await ApexVoice.load(state.voiceId); } catch (_) {}
    }
    function renderLive() {
      const st = window.ApexVoice ? ApexVoice.liveState() : 'idle';
      $('liveVoiceBtn').classList.toggle('on', state.liveVoice);
      $('liveVoiceBtn').setAttribute('aria-checked', String(!!state.liveVoice));
      const info = window.ApexVoice ? ApexVoice.liveInfo() : { text: '' };
      const note = $('liveNote');
      if (note) {
        note.textContent = !state.liveVoice ? ''
          : st === 'error' ? `Failed · ${info.text}`
          : st === 'loading' ? (info.text || 'Loading…')
          : st === 'ready' ? (info.text || 'Ready')
          : 'Loading…';
        note.classList.toggle('err', !!(state.liveVoice && (st === 'error' || info.error)));
        if (!IN_APP_SHELL) note.hidden = !note.textContent;   // off says nothing (TestFlight 2026-11-12: less text)
      }
    }
    // The app never loads the downloaded voice engine (guideline 2.5.2; web/voice.js): no switch, names use the phone voice.
    if (IN_APP_SHELL) { state.liveVoice = false; $('liveVoiceBtn').hidden = true; $('liveNote').hidden = true; }
    $('liveVoiceBtn').addEventListener('click', () => {
      const retry = state.liveVoice && window.ApexVoice && ApexVoice.liveState() === 'error';   // a failed load: tapping again tries again instead of switching off
      if (!retry) state.liveVoice = !state.liveVoice;
      savePrefs();
      if (state.liveVoice && window.ApexVoice) ApexVoice.warmLive().then(() => { renderLive(); if (track) prefetchNames(track); });
      renderLive();
    });
    setInterval(renderLive, 1500);
    renderLive();
    if (window.ApexVoice) ApexVoice.voices().then(v => { bankVoices = v; renderVoiceList(); });
    renderVoiceList();
    // Browsers only allow audio after a user gesture: unlock WebAudio on the first touch.
    document.addEventListener('pointerdown', () => { if (window.ApexVoice) ApexVoice.unlock(); }, { once: true, capture: true });
    function renderCamList() { document.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === state.camFeel)); }
    document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => { state.camFeel = b.dataset.cam; renderCamList(); savePrefs(); }));
    renderCamList();
    $('playBtn').addEventListener('click', () => { setPlaying(!state.playing); });   // the name is on the plate; the pack's voice is for the road
    document.querySelectorAll('#rateDetents [data-rate]').forEach((b) => b.addEventListener('click', () => {
      state.rate = Number(b.dataset.rate);
      document.querySelectorAll('#rateDetents [data-rate]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));
    const scrubber = $('scrubber');
    let scrubbing = false;
    function scrubTo(x) {
      if (!track || state.mode === 'live') return;
      const r = scrubber.getBoundingClientRect();
      state.cursorM = Math.max(0, Math.min(1, (x - r.left) / r.width)) * totalM();
      state.spoken.clear(); resumeFollow();
      render(true);
    }
    scrubber.addEventListener('pointerdown', (e) => { scrubbing = true; scrubber.setPointerCapture(e.pointerId); scrubTo(e.clientX); });
    scrubber.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e.clientX); });
    scrubber.addEventListener('pointerup', () => { scrubbing = false; });
    // Keys (and VoiceOver's adjust gesture where it sends them): arrows step 2 %, Page keys 10 %, Home / End.
    scrubber.addEventListener('keydown', (e) => {
      if (!track || state.mode === 'live') return;
      const T = totalM(), step = { ArrowRight: 0.02, ArrowUp: 0.02, ArrowLeft: -0.02, ArrowDown: -0.02, PageUp: 0.1, PageDown: -0.1 }[e.key];
      let m;
      if (step !== undefined) m = state.cursorM + step * T;
      else if (e.key === 'Home') m = 0;
      else if (e.key === 'End') m = T;
      else return;
      e.preventDefault();
      state.cursorM = Math.max(0, Math.min(T, m));
      state.spoken.clear(); resumeFollow();
      render(true);
    });

    document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.toggle;
      state.toggles[k] = !state.toggles[k];
      paintSwitches();
      if (k === 'lpr') updatePins();
      if (k === 'satellite') {                                         // developers only (applyDevFlags); anyone else: stays off
        if (!devAccess) { state.toggles.satellite = false; paintSwitches(); return; }
        applySatellite();
      }
      if (k === 'haptics' && state.toggles.haptics) haptic('note');   // feel it once
      if (k === 'terrain') {
        if (state.toggles.terrain && mapReady && state.mode !== 'live' && map.getPitch() < 40) map.easeTo({ pitch: 60, duration: 800 });
        applyTerrain(true);                                            // F-10: after the ease, when the page is idle
        if (state.toggles.terrain && power.low) toast('3D terrain waits until the phone stops saving battery.');
      }
      if (k === 'friends') {   // REVIEW.md 5.4: seeing friends; the first time, the sheet explains both choices
        if (!accountMe || !accountMe.member) { state.toggles.friends = false; paintSwitches(); askSignIn('see friends on the map'); return; }
        needSocial().then(() => {                                      // F-03: friends_map.js loads on first use
          if (friendsMap) friendsMap.setLayer(state.toggles.friends);
          let seen = false; try { seen = localStorage.getItem('apex.friendsExplained') === '1'; localStorage.setItem('apex.friendsExplained', '1'); } catch (_) {}
          if (state.toggles.friends && !seen && friendsMap) friendsMap.sheet();
        });
      }
      if (k === 'meets') {   // S-13: public crews' meets near the map
        if (!accountMe || !accountMe.member) { state.toggles.meets = false; paintSwitches(); askSignIn('see car meets on the map'); return; }
        needSocial().then(() => {
          if (meetsMap) meetsMap.setLayer(state.toggles.meets);
          if (state.toggles.meets) toast(`Meets within ${ApexUnits.long(80000, 0)} of the map. Tap a pin.`);   // the Worker's 80 km, in the driver's units
        });
      }
      if (k === 'roadcams') roadCamsLayer(state.toggles.roadcams);   // Ohio's traffic cameras (road_cams.js), loaded on first use
      if (k === 'coverage') {
        updateCoverage();
        if (state.toggles.coverage) toast(mapReady && map.getZoom() < ApexCoverage.MIN_ZOOM ? 'Zoom in to see measured roads.' : 'Tap a road for what was measured. A road with no line earns its first drivers extra points.');
      }
      if (k === 'drivecam') driveCam(driveActive);                    // switched mid-drive: films (or stops) now
      if (k === 'nudge') nudgeSwitched();                              // panel R-1: asks for notifications only now
      if (k === 'push') pushSwitched();                                // push notifications: iOS asks only now
      if (k === 'twisty') {
        updateTwisty();
        if (state.toggles.twisty) toast(mapReady && map.getZoom() < ApexTwisty.MIN_ZOOM ? 'Zoom in to see twisty roads.' : 'Twisty roads come from the map\'s shape, not from drives.');
      }
      savePrefs();
      render(true);
    }));
    document.querySelectorAll('#nightSwitch [data-night]').forEach(b => b.addEventListener('click', () => { state.nightMode = b.dataset.night; applyTheme(); renderThemePicker(); }));   // a car's card follows the mode
    // SO-1 (panel round 2): Notes and Voice have one home, Layers (a drive reaches it); the Garage's link opens it
    $('coNotesLink').addEventListener('click', () => { showView(null); if (!$('swEdge').classList.contains('open')) $('swTab').click(); });
    $('soundtrackHear').addEventListener('click', (e) => soundtrackSample(e.currentTarget));
    // U-82: the Notes detent (Layers): a stop is chosen, never cycled into by a stray tap
    document.querySelectorAll('[data-notes]').forEach(b => b.addEventListener('click', () => {
      if (!NOTES_MODES.includes(b.dataset.notes) || b.dataset.notes === state.notesMode) return;
      state.notesMode = b.dataset.notes;
      syncDerivedToggles(); paintSwitches();
      const full = state.notesMode === 'full';
      // Panel round 2 LA-4: the switch is shown, and heard as the mode chime (rising for Full, falling for Quiet), never a
      // spoken mode name. Auto has none: it is the notes deciding, which the strip shows.
      if (state.notesMode !== 'auto') chime(full ? 'wake' : 'sleep');
      savePrefs();
      render(true);
    }));
    // While Vetta speaks (TestFlight: "my music played a little too loud over it"): Lower music ducks it, as before; Pause
    // music stops it for the line and lets it play on after (the shell's audio session, which CarPlay audio shares). The
    // voice is already at full volume, so the music is what can give. In the app only: a browser can't touch other apps'
    // audio. The shell keeps the choice too, so the first line after a launch already obeys it.
    function sendMusicMode() {
      const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex;
      if (native) { try { native.postMessage({ cmd: 'voiceMusic', mode: state.musicMode }); } catch (_) {} }
      return !!native;
    }
    $('musicCtl').hidden = !sendMusicMode();
    document.querySelectorAll('[data-music]').forEach(b => b.addEventListener('click', () => {
      if (!MUSIC_MODES.includes(b.dataset.music) || b.dataset.music === state.musicMode) return;
      state.musicMode = b.dataset.music;
      savePrefs(); paintSwitches(); sendMusicMode();
    }));
    // Without a position, Auto follows the system setting. Recheck solar time each minute.
    if (darkQuery) darkQuery.addEventListener('change', refreshAutoNight);
    setInterval(refreshAutoNight, 60000);
    window.addEventListener('resize', () => render(true));

    // =======================================================================
    // 10b. DRIVE MODE (web): real GPS + motion, recorded to this device. REPLAY plays a saved drive; the two never mix.
    // =======================================================================
    const drive = { sensors: null, rec: null, status: null, frames: 0, live: null, liveIdx: 0, share: 'off', shareKm: 0, shareErr: null, native: false, roads: {}, roadIdx: 0, rest: null, brakes: null, descentSaid: null, flow: null, wet: null };
    const NATIVE_SHELL = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex);
    // Film the drive (big bet 5, DriveCam.swift): only the app has a camera to film with; on the web the setting is not offered
    // (its row hides when #driveCamRow is empty). On while a drive runs with the switch set; the shell says what it is doing.
    if (!NATIVE_SHELL && $('driveCamRow')) $('driveCamRow').replaceChildren();
    var driveCamOn = false;                                           // (var: enterDrive may run before this line is reached)
    function driveCam(want) {
      const on = !!(want && NATIVE_SHELL && state.toggles.drivecam);
      if (on === driveCamOn || !NATIVE_SHELL) return;
      driveCamOn = on;
      try { window.webkit.messageHandlers.apex.postMessage({ cmd: 'driveCam', on }); } catch (_) {}
    }
    function driveCamSaid(st) {
      const n = $('driveCamState');
      if (st === 'denied') {
        if (n) n.textContent = 'Vetta can\'t use the camera. Allow it in the iPhone\'s Settings → Vetta → Camera.';
        if (driveCamOn) toast('Not filming: Vetta can\'t use the camera. Allow it in Settings → Vetta.');
      } else if (st === 'unavailable') { if (n) n.textContent = 'This phone\'s back camera isn\'t available to film with.'; }
      else if (st === 'on' && n) n.textContent = 'Filming this drive.';
      else if (st === 'off' && n) n.textContent = 'Films while Vetta is on the phone\'s screen. Videos stay on this phone, the oldest going after about two hours of them.';
    }
    function paintModeSwitch() {
      const on = state.mode === 'live';
      $('driveBar').hidden = !on; $('transport').hidden = on;
      $('app').classList.toggle('live', on);
      if (!on) { $('hzPlate').hidden = true; measurePlanBar(); }
      if (on) { $('app').classList.remove('sheet-open'); openPlan(false); }
      if (on !== drawDetail.edges) { drawDetail.edges = on; setDriveEdges(on); }   // F-02/F-05: once per start and end
    }
    // In the iOS app the switch lives under the app, not Safari.
    const LOC_HOW_TEXT = `Settings → ${window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex ? 'Vetta' : 'Safari'} → Location → Allow`;
    const MOT_DENIED_TEXT = 'No motion · surface not recorded';
    let locDenied = false, motDenied = false;
    // The sheet before a drive has two faces. Before the first drive: what the drive uses, and Allow and start. With Location
    // off (the driver said no, in the app or the browser): that, said once, why it matters and the way back: the app's key
    // opens its own page in Settings; a browser has no such door, so its key tries again once the driver has allowed it.
    // No key is ever greyed out without a word: Just drive stays a key and opens this.
    function paintPerms() {
      const sheet = $('permSheet');
      sheet.classList.toggle('loc-off', locDenied);
      sheet.setAttribute('aria-label', locDenied ? 'Location is off' : 'Before your first drive');
      $('permTitle').textContent = locDenied ? 'Location is off' : 'Before your first drive';
      $('permMot').textContent = motDenied ? MOT_DENIED_TEXT : 'to feel bumps and surface';
      $('permNote').textContent = locDenied ? `Vetta can\u2019t record a drive or call the corners ahead without it. ${NATIVE_SHELL ? 'In Settings, set Location to While Using the App.' : `Turn it on: ${LOC_HOW_TEXT}.`}` : 'Your drive stays on this phone.';
      $('permGo').textContent = locDenied ? (NATIVE_SHELL ? 'Open Settings' : 'Try again') : 'Allow and start';
      $('permGo').className = locDenied ? 'ink-btn solid' : 'rec-key';   // the red key is go; a way to Settings is ink
    }
    /** The app's own word on Location (a live frame's location_off): the system sheet answered no, or turned off since. */
    function setLocOff(off) {
      if (off === locDenied) return;
      locDenied = off;
      if (drive.native && drive.status) drive.status.gps = off ? 'denied' : 'waiting';
      if (!off && $('permSheet').classList.contains('loc-off')) $('permSheet').classList.remove('show');   // back from Settings with it on
      paintPerms(); paintDriveStat();
    }
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((p) => {
        const sync = () => { locDenied = p.state === 'denied'; paintPerms(); };
        sync(); p.onchange = sync;
      }).catch(() => {});
    }
    // Glanceable at arm's length: the recording (and sharing) in large type on top; below it, only what needs the
    // driver's attention. Healthy GPS and motion say nothing. Only the attention line is a live region, so the
    // mileage ticking up never chatters to VoiceOver.
    function paintDriveStat() {
      const s = drive.status || {}, r = drive.rec, main = [], warn = [];
      const zoned = state.lastPosition && inPrivacyZone(state.lastPosition.lat, state.lastPosition.lon);
      if (s.gps === 'denied') main.push('Location is off');
      else if (zoned) main.push('<b>Privacy zone</b> · not recording');
      else if (r && r.samples > 0) main.push(`<b>● Rec</b> ${ApexUnits.long((r.km) * 1000, 2)}`);
      else main.push(s.gps === 'on' ? 'Starting…' : 'Finding GPS…');
      if (s.mountSetUntil > performance.now()) main.push('Mount set');   // the calibration lock (U-74)
      if (etaText) main.push(...etaText.split(' · '));                  // U-99: "25 min left" and "7:12" are parts of their own
      if (NATIVE_SHELL) { const a = ambientStats(); if (a) main.push(a.error ? 'Sharing · retrying' : a.paused ? 'Sharing paused' : `Sharing ${ApexUnits.long((a.km) * 1000, 1)}`); }
      else if (drive.share === 'on') main.push(drive.shareErr ? 'Sharing · retrying' : `Sharing ${ApexUnits.long((drive.shareKm) * 1000, 1)}`);
      else if (drive.share === 'stopped') main.push('Sharing paused');
      else if (drive.share === 'zone' && !zoned) main.push('Sharing off after a privacy zone');
      if (s.gps === 'denied') warn.push(LOC_HOW_TEXT);
      else if (s.message) warn.push(s.message);                                       // weak or lost GPS, in the sensor's words
      else if (s.gps === 'weak') warn.push('Weak GPS · keep the sky in view');
      else if (s.gps === 'error') warn.push('GPS error');
      if (s.motion === 'denied' || s.motion === 'unavailable') warn.push(MOT_DENIED_TEXT);
      if (s.wake === 'unavailable') warn.push('Keep the screen on');
      // The app's mount calibration (ApexKit): until locked, g, camber and crest are recorded as unknown
      if (s.calibration === 'default') warn.push('Calibrating · leave the phone in its mount');
      else if (s.calibration === 'awaitingPull') warn.push('Calibrating · drive normally');
      else if (s.calibration === 'paused') warn.push('Phone is hot · bumps and banking paused');
      // a browser's own mount calibration (live_pipeline.js, IDEAS A-02): banking only once checked against GPS; silent until then
      if (!NATIVE_SHELL && s.webMount === 'verified') main.push('Banking measured');
      // each part stays whole: a narrow screen breaks the line between parts, never inside "77 min left", and never cuts one
      // (U-99: the line was one nowrap run, so "25 min left · 7:12" ended "25…"). The dot rides with the part before it, so a
      // wrapped line never starts with one.
      const m = main.map((x, i) => `<span>${x}${i < main.length - 1 ? ' ·' : ''}</span>`).join(' '), w = warn.join(' · ');
      if ($('dsMain').innerHTML !== m) $('dsMain').innerHTML = m;
      // the line's state, for its drawing (index.html #driveBar[data-state]): seek until the first sample is kept
      const ds = s.gps === 'denied' ? 'off' : zoned ? 'zone' : r && r.samples > 0 ? 'rec' : 'seek';
      if ($('driveBar').dataset.state !== ds) $('driveBar').dataset.state = ds;
      if ($('dsWarn').textContent !== w) $('dsWarn').textContent = w;
      if ($('dsWarn').hidden !== !w) $('dsWarn').hidden = !w;
    }
    // Road data streams while you drive when you are a member with ROAD DATA on: settled stretches only (never the first or last km).
    // Camber and crest go up when the recorder kept them (calibrated mount).
    function feedLive() {
      const L = drive.live, r = drive.rec; if (!L || !r) return;
      while (drive.liveIdx < r.rows.length) { const x = r.rows[drive.liveIdx++]; L.push({ lat: x.lat, lon: x.lon, roughness_rms: x.roughness_rms, camber_deg: x.camber_deg, camber_v: x.camber_v, crest: x.crest_vertical_g, speed_mps: x.speed_mps, lon_g: x.lon_g, vert_peak_g: x.vert_peak_g }); }
    }
    // The live Vetta Score (REVIEW.md 1.2, Driving; 4.3): the drive so far scored the way the end card scores it, every 30 s
    // while recording; null (shown "--") until there are enough clean corners.
    const liveScore = { value: null, at: 0, busy: false };
    function liveScoreTick() {
      const r = drive.rec;
      if (!r || r.samples < 200) { liveScore.value = null; return; }   // a new drive starts at --
      if (liveScore.busy || performance.now() - liveScore.at < 30000) return;
      liveScore.busy = true; liveScore.at = performance.now();
      setTimeout(() => {
        try {
          const d = ApexRecording.parse(Core, r.toCsv(), 'live.csv', { source: 'web-gps' });
          const car = routingCar();
          if (car) d.car = { mu: Core.carGrip(car) };                 // U-91: the car's grip, as the saved drive will be scored
          const s = ApexRecording.scoreOf(Core, d).ds.score;
          liveScore.value = s == null ? null : Math.round(s);
        } catch (_) { liveScore.value = null; } finally { liveScore.busy = false; }
      }, 0);
    }
    // Which road the drive is on, every 150 m (30 rows), read from the map's own vector tiles (ApexRoadNames):
    // the saved drive is named after the road that carried most of it. Nothing leaves the phone for this.
    function noteRoads() {
      liveScoreTick();
      const r = drive.rec; if (!r || !window.ApexRoadNames) return;
      while (drive.roadIdx + 30 <= r.rows.length) {
        drive.roadIdx += 30;
        const x = r.rows[drive.roadIdx - 1];
        let feats = [];
        try { feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name' }); } catch (_) { /* style not loaded */ }
        const name = ApexRoadNames.nearestRoadName(feats, x.lat, x.lon);
        if (name) drive.roads[name] = (drive.roads[name] || 0) + 150;
      }
    }
    // Break cue (IDEAS D-16, live): ApexRoadMemory.restTick keeps the clock (restarted by 15 min standing still); once an
    // hour has passed, every 10 min the driving since the stop goes to break_worker.js (Core.fatigue, off the main thread).
    // The cue is shown at once and spoken by the notes loop when no call is due (breakSay), like the remembered tips. A
    // reading that fails or takes over BREAK_WAIT_MS counts as unknown, so the time cue still comes.
    const BREAK_WAIT_MS = 30000;
    let breakWorker = null, breakSeq = 0;
    function noteRest(frame) {
      const r = drive.rec; if (!r) return;
      let due;
      [drive.rest, due] = ApexRoadMemory.restTick(drive.rest, Date.now(), frame.speed_mps, r.rows.length, [frame.lat, frame.lon]);
      const w = drive.rest, stretch = w.stretch;
      if (!due || w.busy) return;
      w.busy = true;
      const finish = (fa) => {
        if (drive.rec !== r || drive.rest !== w || w.stretch !== stretch) return;   // the drive ended or a new stretch began
        w.busy = false;
        const t = Date.now(), cue = ApexRoadMemory.breakCue(fa, (t - w.since) / 1000, w.said == null ? null : (t - w.said) / 1000, w.spoken);
        if (!cue) return;
        w.said = t;
        toast(cue.text);
        if (!w.spoken.includes(cue.kind)) { w.spoken.push(cue.kind); breakSay = { text: cue.text, until: performance.now() + 5 * 60000 }; }
      };
      const rows = r.rows.length - w.row0 > 200 ? ApexRoadMemory.rebase(r.rows.slice(w.row0)) : null;
      if (!rows) { finish(null); return; }
      let wk;
      try { wk = breakWorker = breakWorker || new Worker('break_worker.js'); } catch (_) { finish(null); return; }
      const id = ++breakSeq;
      let timer = null;
      const done = (fa, broken) => {
        clearTimeout(timer);
        wk.removeEventListener('message', onMsg); wk.removeEventListener('error', onErr); wk.removeEventListener('messageerror', onErr);
        if (broken && breakWorker === wk) { try { wk.terminate(); } catch (_) {} breakWorker = null; }   // a fresh one next time
        try { finish(fa); } finally { if (drive.rest === w && w.stretch === stretch) w.busy = false; }
      };
      const onMsg = (e) => { if (e.data && e.data.id === id) done(e.data.fa, false); }, onErr = () => done(null, true);
      wk.addEventListener('message', onMsg); wk.addEventListener('error', onErr); wk.addEventListener('messageerror', onErr);
      timer = setTimeout(() => done(null, true), BREAK_WAIT_MS);
      wk.postMessage({ id, rows });
    }
    // Brake heat (web/brake_heat.js, core/brake_heat.py): energy the car loses faster than rolling and air take it went into
    // the discs (or the engine in a low gear: an upper bound). When the model says hot, the co-driver says so once in words,
    // in its own quiet slot, said before a waiting break cue (hot brakes matter more than a rest), and a toast shows it. Frames come
    // at 10 Hz from the app with speed held between fixes: the model differences energy over 2 s windows for that.
    // At most once every 3 minutes, and only again after the discs cooled. Nothing leaves the phone.
    function noteBrakes(frame) {
      if (!window.ApexBrakeHeat || !drive.rec) return;
      const now = performance.now(), b = drive.brakes || (drive.brakes = { model: ApexBrakeHeat.create(), at: null });
      const dt = b.at === null ? 0 : (now - b.at) / 1000; b.at = now;
      const out = b.model.step(dt, frame.speed_mps, frame.elevation_m);
      if (!out.call) return;
      toast(ApexBrakeHeat.CALL_TEXT);
      brakeSay = { text: ApexBrakeHeat.CALL_TEXT, until: now + 60000 };   // its own slot: a break cue waiting stays as it is
    }
    // The best run, live (web/flow_live.js, IDEAS D-30): corners driven smooth and settled in a row, judged as the drive
    // page's best run judges them, on the rows just recorded; the co-driver says the count at five, ten and every ten after,
    // in the quiet slot below a break cue (praise waits; a line 20 s late means nothing, so it is dropped). The car's grip
    // is the saved drive's (routingCar). Technique only: a slow, smooth run counts the same as a quick one.
    // Wet roads (wet_roads.js): the place plate's weather for where you are (refreshPlacePlate keeps it, every 20 min or
    // 5 km, while driving too); a wet or icy road brings the notes earlier (note_timing.js setRoad) and is said once.
    // Unknown weather leaves the dry road; nothing new is asked of anyone.
    function noteWet() {
      if (!window.ApexWetRoads || !window.ApexPlacePlate || !driveActive) return;
      const w = drive.wet || (drive.wet = { data: null, state: null, said: null, weather: null, sensor: null, sensorAt: -1e9 });
      // ODOT's road weather sensors near you (road_surface.js sensorAt, the traffic feed's wet and icy sites), looked at
      // every 30 s: a sensor's wet or icy road counts as the weather's does, the worse of the two kept
      const S = window.ApexRoadSurface, now = performance.now(), p = state.lastPosition;
      let changed = false;
      if (S && p && now - (w.sensorAt ?? -1e9) >= 30000) {
        w.sensorAt = now;
        const sn = S.sensorAt(roadEvents.list, p.lat, p.lon);
        if (sn !== (w.sensor ?? null)) { w.sensor = sn; changed = true; }
      }
      const d = placeAsk.data;
      if (d && d !== w.data) {
        w.data = d;
        const ws = ApexWetRoads.stateOf(ApexPlacePlate.weather(d), d.tempC);
        if (ws != null) { w.weather = ws; changed = true; }               // unknown: keep what we had
      }
      if (!changed) return;
      const st = S ? S.worse(w.weather ?? null, w.sensor ?? null) : (w.weather ?? null);
      if (st == null) return;
      if (drive.surface) drive.surface.see(st);                          // the worst of the drive, kept on its record
      w.state = st;
      ApexNoteTiming.setRoad(ApexWetRoads.road(st));
      const line = ApexWetRoads.line(st);
      if (line && w.said !== st) { w.said = st; toast(line); sayQuietLine(line); }
      // cold tyres on a dry road (wet_roads.js coldLine): once a drive, and once a day, so a winter of drives isn't told daily
      const car = routingCar(), cold = !w.cold && !!d && ApexWetRoads.coldLine(st, d.tempC, car && car.tyres);
      if (cold) {
        w.cold = true;
        const today = new Date().toDateString();
        let last = null; try { last = localStorage.getItem('apex.coldSaid'); } catch (_) {}
        if (last !== today) { try { localStorage.setItem('apex.coldSaid', today); } catch (_) {} toast(cold); sayQuietLine(cold); }
      }
    }
    function noteFlow() {
      if (!window.ApexFlowLive || !window.ApexFlow || !drive.rec) return;
      if (!drive.flow) {
        const car = routingCar(), w = drive.flow = ApexFlowLive.createWatch(Core, ApexFlow, { mu: car ? Core.carGrip(car) : null });
        // this month's best run in the Log, read once after Start: passing it is said ("…, your best this month.")
        const now = new Date(), key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (window.ApexAnalysis && ApexAnalysis.monthOf) ApexRecording.summaries(null)
          .then((all) => { if (drive.flow === w) w.setBest(ApexFlowLive.monthBest(all, ApexAnalysis.monthOf, key)); }).catch(() => {});
      }
      const r = drive.flow.update(drive.rec.rows);
      if (!r || !r.say) return;
      sayQuietLine(r.say);
    }
    // The lowest of the quiet slots (flow lines, a stage's result): said when no call is due, gone after 20 s or in Quiet notes
    function sayQuietLine(text) {
      const line = { text, until: performance.now() + 20000 };
      if (!flowSay) flowSay = line; else if (flowQueue.length < 2) flowQueue.push(line);   // "Eight…, your best" is not lost to "Ten"
    }
    // Road data whenever the app is open and the phone is mounted (calibration locked), not only during a drive
    // (owner 2026-10-26). Trips, privacy trims and gaps: ApexContributor.createAmbient. Members with ROAD DATA on only.
    const ambient = { sharer: null, allowed: null, member: null, checkedAt: -Infinity, checking: false, mounted: false };
    function ambientStats() { return ambient.sharer ? ambient.sharer.stats() : null; }
    function paintAmbient() {
      const note = $('ambientNote'); if (!note) return;
      const a = ambientStats(), mi = a ? `${ApexUnits.long((a.km) * 1000, 1)} shared since the app opened` : '';
      // U-116: the line for the state you are in: signed out, a member with the switch off (nothing: the switch right above
      // already says Off, 2026-11-13), or on
      note.textContent = ambient.allowed === false ? (ambient.member ? '' : 'Off. Sign in to share road feel.')
        : !NATIVE_SHELL ? 'Sharing banking, bumps and surface while you drive. In the iPhone app it also shares whenever the phone is mounted.'
        : !ambient.mounted ? 'Waiting for the phone to be calibrated in its mount.'
        : a && a.paused ? 'Paused: the server refused. Trying again in a few minutes.'
        : a && a.error ? `Couldn't reach the server. Retrying. ${mi}`
        : `Sharing while the phone is mounted. ${mi || 'Starts once you move.'} The first and last km of every trip stay on this phone.`;
      // 2026-11-13 (free roamer B): signed out, the line said "Sign in" with no way to; the key under it opens People, where
      // signing in is (as every other "Sign in to …"), and the Settings row reads Off from it
      const si = $('ambientSignIn'); if (si) si.hidden = !(ambient.allowed === false && !ambient.member);
    }
    $('ambientSignIn')?.addEventListener('click', () => { if (window.ApexGarageSettings && ApexGarageSettings.ui) ApexGarageSettings.ui.close(); showView('friends'); });
    // what the Garage just read of the account (renderAccount): who you are and the Share road feel switch, said at once
    function ambientFromAccount(member, on) {
      ambient.member = member; ambient.allowed = !!(member && on); ambient.checkedAt = performance.now(); paintAmbient();
      if (!ambient.allowed && ambient.sharer) ambient.sharer.stop();
    }
    async function checkAmbientAllowed() {
      if (ambient.checking || performance.now() - ambient.checkedAt < 600000) return;
      ambient.checking = true;
      try { const sh = window.ApexSync ? await ApexSync.roadShare() : { on: false, member: false }; ambient.member = !!sh.member; ambient.allowed = !!sh.on; }
      catch (_) { ambient.allowed = null; }
      finally { ambient.checking = false; ambient.checkedAt = performance.now(); paintAmbient(); }
      if (ambient.allowed === false && ambient.sharer) ambient.sharer.stop();
    }
    // ---- hazards people reported (hazard_reports.js; backend/src/hazards.ts) -----------------------------------------
    // `local`: U-94, what the review recording reported, kept on this phone (reviewHazard); the server never hears of it.
    // VI-1: asked by the 0.1-degree cell (privacy_zones.js cell), kept per cell for 2 min, filtered and sorted here; never
    // from a privacy zone or before the drive's private edge (nearLookupOk).
    const reported = { list: [], at: -Infinity, cellKey: '', busy: false, said: new Set(), mine: new Set(), pins: new Map(), watch: ApexHazardReports.createPassWatch(), asking: null, local: [],
                       cells: ApexPrivacyZones.cellCache(120e3), ahead: ApexPrivacyZones.cellCache(6 * 3600e3, 16), aheadFor: null };
    if (window.apexDebug) { window.apexDebug.loadReported = (force) => loadReported(force); window.apexDebug.reportedIds = () => reported.list.map((h) => h.id); }   // e2e: a report that lands mid-drive
    // ---- Road cameras (road_cams.js, 2026-11-14): Ohio DOT's traffic cameras, an opt-in layer; a tap shows the road now ----
    let roadCams = null;
    async function roadCamsLayer(on) {
      try {
        if (!roadCams) {
          if (!on) return;
          await ApexLazy.load('roadcams');
          const css = getComputedStyle(document.documentElement);
          roadCams = ApexRoadCams.mount({ map, el, btn, toast, apiFetch: (path) => ApexSync.apiFetch(path, { method: 'GET' }),
            driving: () => driveActive && state.mode === 'live',
            ink: () => ({ dot: css.getPropertyValue('--panel-ink').trim() || '#1a1a1a', edge: css.getPropertyValue('--panel').trim() || '#ffffff' }) });
        }
        await roadCams.setLayer(on);
      } catch (_) { if (on) toast('Road cameras didn\'t load. Check signal.'); }
    }
    if (window.apexDebug) window.apexDebug.roadCams = () => roadCams;
    // ---- the DOTs' own traffic events (road_events.js; backend/src/traffic.ts) ------------------------------------------
    // Closures, lane closures, roadwork, slow traffic and crashes from INDOT, KYTC (and ODOT with the owner's key): the whole
    // region asked every 5 min while planning or driving, never where you are; signed in or not. What is near you joins the
    // drivers' reports in reported.list (`official`), so it gets the same pins, plate, voice and car plates; the full
    // closures (both ways) are routed round like a reported closure.
    const roadEvents = { list: [], closures: [], at: NaN, busy: false, mergedAt: null };
    if (window.apexDebug) window.apexDebug.loadRoadEvents = () => loadRoadEvents(true);
    if (window.apexDebug) window.apexDebug.setRoadEvents = (json) => { roadEvents.list = window.ApexRoadEvents ? ApexRoadEvents.rows(json) : []; };   // e2e: the feed as it came
    function roadEventsNear(p) { return p && window.ApexRoadEvents ? ApexRoadEvents.near(roadEvents.list, p.lat, p.lon, Date.now()) : []; }
    async function loadRoadEvents(force = false) {
      if (!window.ApexRoadEvents || !window.ApexSync || roadEvents.busy || window.APEX_REVIEW) return;
      if (!force && !ApexRoadEvents.due(roadEvents.at, Date.now())) return;
      roadEvents.busy = true; roadEvents.at = Date.now();
      try {
        const r = await ApexSync.apiFetch('/api/traffic/v1/events.json', { method: 'GET' });
        if (!r.ok) return;                                                 // a feed down: what we had stays, asked again in 5 min
        roadEvents.list = ApexRoadEvents.rows(await r.json());
        roadEvents.closures = ApexRoadEvents.closures(roadEvents.list);
        mergeRoadEvents(true);
        // they landed after the route card went up: its word again (a closure the route passes)
        if (plannedRoute && !driveActive && typeof renderRouteCard === 'function') setTimeout(() => { try { if (plannedRoute) renderRouteCard(plannedRoute); } catch (_) {} }, 0);
      } catch (_) { /* offline: what we had */ }
      finally { roadEvents.busy = false; }
    }
    // the events round where you are now, into reported.list: on new ones, or once you're 1 km from the last merge
    function mergeRoadEvents(force = false) {
      const p = state.lastPosition;
      if (!p || !window.ApexRoadEvents || (!force && !ApexRoadEvents.moved(roadEvents.mergedAt, p))) return;
      roadEvents.mergedAt = { lat: p.lat, lon: p.lon };
      reported.list = reported.list.filter((h) => h && !h.official).concat(roadEventsNear(p));
      paintReported(); carHazards();
    }
    async function loadReported(force = false) {
      const p = state.lastPosition, c = p && ApexPrivacyZones.cell(p.lat, p.lon);
      if (!c || reported.busy || !window.ApexSync || !nearLookupOk(p)) return;
      const keep = (rows) => { roadEvents.mergedAt = { lat: p.lat, lon: p.lon }; reported.list = ApexPrivacyZones.nearFirst(rows, p.lat, p.lon, 20).concat(reported.local, roadEventsNear(p)); paintReported(); carHazards(); };
      const kept = force ? undefined : reported.cells.get(c.key);
      if (kept) { if (c.key !== reported.cellKey) { reported.cellKey = c.key; keep(kept); } return; }   // a cell asked for under 2 min ago
      if (!force && c.key === reported.cellKey && performance.now() - reported.at < 120e3) return;
      reported.busy = true;
      try {
        const r = await ApexSync.apiFetch(`/api/hazards?${ApexPrivacyZones.cellQuery(p.lat, p.lon, 20)}`, { method: 'GET' });
        if (r.ok) { const rows = await r.json(); reported.cells.set(c.key, rows); reported.cellKey = c.key; keep(rows); }
        else keepAhead(c, keep);
      } catch (_) { keepAhead(c, keep); /* offline: what was asked ahead for this cell, else what we had */ }
      finally { reported.at = performance.now(); reported.busy = false; }
    }
    // no signal in a cell the planned route runs through: the reports asked for it as the drive started (askAhead), the
    // expired ones dropped; the next lookup waits the usual 2 minutes
    function keepAhead(c, keep) {
      const rows = reported.ahead.get(c.key);
      if (!rows || c.key === reported.cellKey) return;
      reported.cellKey = c.key;
      keep(ApexHazardReports.stillLive(rows));
    }
    // IDEAS F-03: a drive on a planned route asks, while there is signal, for the reports in the cells the route runs through
    // (privacy_zones.js routeCells: the same coarse cells as any lookup, never the ends' cells or a privacy zone's), so a dead
    // zone on the way still has them. Once per route; members only; anything that fails just asks nothing.
    async function askAhead(t) {
      if (!t || t.kind !== 'route' || reported.aheadFor === t || !window.ApexSync || window.APEX_REVIEW) return;
      if (navigator.onLine === false) {                             // no signal at the start: what was kept when it was saved
        const kept = window.ApexRouteReports && t.id ? ApexRouteReports.load(localStorage, String(t.id)) : null;
        if (kept) { reported.aheadFor = t; for (const [k, rows] of Object.entries(kept.cells)) reported.ahead.set(k, rows); }
        return;
      }
      reported.aheadFor = t;
      const got = await askCellsAlong(t, () => reported.aheadFor === t);
      if (reported.aheadFor !== t) return;
      // a cell the live ask couldn't get (one bar, a dead stretch at the start): the reports kept with a saved route fill it
      const kept = window.ApexRouteReports && t.id && window.ApexSync && ApexSync.signedIn() ? ApexRouteReports.load(localStorage, String(t.id)) : null;
      if (kept) for (const [k, rows] of Object.entries(kept.cells)) if (!got || !(k in got)) reported.ahead.set(k, rows);
      if (!got) return;
      for (const [k, rows] of Object.entries(got)) reported.ahead.set(k, rows);
      if (window.apexDebug) window.apexDebug.askedAhead = Object.keys(got).length;
    }
    // the reports in the cells a route runs through ({ cellKey: rows }), members only; null when nothing could be asked.
    // `still()` false stops the asking (the route changed).
    async function askCellsAlong(t, still = () => true) {
      const edgeM = Math.max(1500, window.ApexContributor ? ApexContributor.privateEdge() * 5 : 0);
      const cells = ApexPrivacyZones.routeCells(t.lat, t.lon, privacyZones, edgeM);
      if (!cells.length || !(await RouteLoading.optional(ApexSync.member(), 4000).catch(() => null))) return null;
      const out = {};
      for (const c of cells) {
        if (!still()) return null;
        try {
          const r = await RouteLoading.optional(ApexSync.apiFetch(`/api/hazards?${ApexPrivacyZones.cellQuery(c.lat, c.lon, 20)}`, { method: 'GET' }), 6000);
          const rows = r && r.ok ? await r.json() : null;
          if (Array.isArray(rows)) out[c.key] = rows;
        } catch (_) { /* this cell stays unasked */ }
      }
      return out;
    }
    // Saving a route for offline keeps the reports along it too (route_reports.js), so its card and a drive on it in a dead
    // zone still know them; the card says how old they are. Members only, while there is signal.
    async function keepReportsAlong(t) {
      if (!t || !t.id || !window.ApexRouteReports || !window.ApexSync || navigator.onLine === false || window.APEX_REVIEW) return;
      const got = await askCellsAlong(t, () => ApexSavedRoutes.has(localStorage, t.id)).catch(() => null);
      if (got && Object.keys(got).length && ApexSavedRoutes.has(localStorage, t.id)) ApexRouteReports.save(localStorage, String(t.id), got);
      if (window.apexDebug) window.apexDebug.keptReports = got ? Object.keys(got).length : 0;
    }
    // Viewpoints, cafés and fuel along a planned route (IDEAS R-24, R-23; stages.js pois, scenic.js): pins on the map and a
    // line on the route card. Map data: a mapped viewpoint, a fuel station that may be closed. Nothing found says nothing.
    const scenicPins = [];
    const SCENIC_LABEL = { view: 'VIEW', falls: 'FALLS', cafe: 'CAFÉ', fuel: 'FUEL', charge: 'CHARGE' };
    // Seasonal and time-of-day closures (conditional_closures.js, IDEAS R-22): OSM conditional access tags on the roads the
    // route uses, read for when you'd get there. A trip over 1° across, or the map offline: nothing said.
    async function attachClosures(t) {
      $('routeCardClosures').hidden = true;
      if (!t || !Array.isArray(t.lat) || t.lat.length < 2 || !window.ApexConditional) return;
      let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
      for (let i = 0; i < t.lat.length; i++) { s = Math.min(s, t.lat[i]); n = Math.max(n, t.lat[i]); w = Math.min(w, t.lon[i]); e = Math.max(e, t.lon[i]); }
      if (n - s > 1 || e - w > 1) return;
      const json = await ApexCameras.fetchFirst(fetch, 'data=' + encodeURIComponent(ApexConditional.query(s - 0.005, w - 0.005, n + 0.005, e + 0.005)));   // every server raced
      if (!json || plannedRoute !== t) return;
      const total = t.dist[t.dist.length - 1], now = leaveAt();
      const secAt = (m) => (Number.isFinite(t.timeS) ? t.timeS - ApexEta.routerLeft(m, total, t.timeS, t.timeMarks) : m / (50 / 3.6));
      const ways = (json.elements || []).filter((x) => x.center && x.tags).map((x) => {
        const hit = Core.nearestIndex(x.center.lat, x.center.lon, t.lat, t.lon, -1);
        return hit.distM <= 80 ? { tags: x.tags, m: t.dist[hit.index], atMs: now + 1000 * secAt(t.dist[hit.index]), lat: x.center.lat, lon: x.center.lon } : null;
      }).filter(Boolean);
      const list = ApexConditional.check(ways), line = ApexConditional.summary(list);
      $('routeCardClosures').textContent = line;
      $('routeCardClosures').hidden = !line;
      // closed when you'd get there: one tap routes around it (the closed road goes to the router as an exclusion)
      const shut = list.filter((x) => x.closed === true && Number.isFinite(x.lat));
      if (shut.length) {
        const b = document.createElement('button'); b.className = 'linkbtn'; b.textContent = 'Route around it';
        b.addEventListener('click', async () => {
          avoidPoints.push(...shut.map((x) => ({ lat: x.lat, lon: x.lon })));
          if (t.id === 'route_dest' && !t.request.via.some((v) => !v.shaping)) { await replanForLevel('Routing around the closure'); return; }
          const from = t.request.from || await locate();
          if (!from) { toast(NO_FIX); return; }
          await buildRoute([from, ...t.request.via, t.request.to], t.id, t.name, null, t.request);
        });
        $('routeCardClosures').append(' ', b);
      }
    }
    // Weather in the ranking (route_weather.js cost, IDEAS R-21): the top few candidates' forecasts for when you'd drive
    // them; ice, snow, storms, rain and fog cost fun points, so a drier way can win. Offline or a failed forecast: no cost.
    // Each candidate's forecast along its line (Open-Meteo), asked for alongside the route context so the plan doesn't wait
    // for it afterwards (live: 2-6 s on top of the context), WEATHER_MS at most. Map of candidate -> Promise<{ json, pts }|null>.
    const WEATHER_MS = 2500, WEATHER_GRACE_MS = 400;
    function forecastOf(c) {
      const pts = ApexRouteWeather.samplePoints(c.t, leaveAt(), Number.isFinite(c.timeS) ? (m) => c.timeS * m / Math.max(1, c.t.dist[c.t.dist.length - 1]) : null);
      return (async () => {
        const ac = new AbortController(), timer = setTimeout(() => ac.abort(), WEATHER_MS);
        try { const r = await fetch(ApexRouteWeather.url(pts), { signal: ac.signal }); return r.ok ? { json: await r.json(), pts } : null; }
        catch (_) { return null; } finally { clearTimeout(timer); }
      })();
    }
    function weatherFetch(pool) {
      const out = new Map();
      if (!window.ApexRouteWeather || pool.length < 2) return out;
      for (const c of pool.slice(0, 10)) out.set(c, forecastOf(c));
      return out;
    }
    async function weatherOn(pool, level, forecasts, graceMs = WEATHER_GRACE_MS) {
      if (!window.ApexRouteWeather || pool.length < 2) return;
      const top = rankPool(pool, level).slice(0, 4).map(r => pool.find(c => c.t === r.t)).filter(Boolean);
      const asked = forecasts || new Map();
      // the plan doesn't wait on a slow forecast: what isn't in WEATHER_GRACE_MS after the context costs nothing for anyone
      const grace = new Promise((r) => setTimeout(() => r(null), graceMs));
      const costs = await Promise.all(top.map(async (c) => {
        const f = await Promise.race([asked.get(c) || forecastOf(c), grace]);   // a contender past the first ten: asked now
        if (!f) return null;
        try {
          // fog the route engine already costs per km (conditions' fog_risk / visibility) isn't costed again here
          const fogKnown = !!(c.ctx && c.ctx.channels && ['fog_risk', 'visibility_m', 'fog_vis_m'].some((k) => c.ctx.channels[k] && Array.from(c.ctx.channels[k]).some(Number.isFinite)));
          const iceKnown = !!(c.ctx && (c.ctx.spans || []).some((x) => x.kind === 'ice'));   // conditions.js frost spans, costed per km
          return ApexRouteWeather.cost(ApexRouteWeather.atArrival(f.json, f.pts), [...(fogKnown ? ['fog'] : []), ...(iceKnown ? ['ice'] : [])]);
        } catch (_) { return null; }
      }));
      // only when every one came back, and only the difference: rain over the whole area changes nothing
      if (costs.some(x => x == null)) return;
      const least = Math.min(...costs);
      top.forEach((c, i) => { c.weatherCost = costs[i] - least; });
    }
    // The Prefer stamps (prefer.js): the share of each contender that members measured (applyMeasured), that you haven't
    // driven (your Log, on this phone) and that your crews shared (their routes, members only), as a few fun points each.
    const preferCache = { driven: null, crew: null, at: 0 };
    const PREFER_CREW_MS = 300;
    async function preferGrids(want) {
      if (Date.now() - preferCache.at > 10 * 60000) { preferCache.driven = null; preferCache.crew = null; preferCache.at = Date.now(); }
      if (want.novel && !preferCache.driven && window.ApexRecording) {
        try { preferCache.driven = new Set((await ApexAnalysis.job('drivenGrid')).cells); } catch (_) { preferCache.driven = new Set(); }   // in the worker (F-08)
      }
      if (want.crew && !preferCache.crew) {
        // your crews' shared routes (13 requests): asked once per 10 min, and the card waits PREFER_CREW_MS for them at
        // most (before, without a limit: on a weak signal the card waited for the network); late, they land for the next plan
        const ask = preferCache.crewP || (preferCache.crewP = (async () => {
          try {
            const list = (await apiCall('GET', '/api/routes/shared').then(jsonOf)) || [];
            const geoms = await Promise.all(list.filter(r => r.crew).slice(0, 12).map(r => apiCall('GET', `/api/routes/${encodeURIComponent(r.id)}`).then(jsonOf).then(x => (x && x.geom) || []).catch(() => [])));
            preferCache.crew = ApexPrefer.grid(geoms);
            preferCache.crewLines = geoms;                                   // the crowd provider's crew-shared lines (loved roads)
          } catch (_) { preferCache.crew = new Set(); }
          preferCache.crewP = null;
        })());
        await RouteLoading.optional(ask, PREFER_CREW_MS);
      }
      return preferCache;
    }
    async function preferOn(pool, level) {
      for (const c of pool) c.preferBonus = 0;
      await preferApply(rankPool(pool, level).slice(0, 4).map(r => pool.find(c => c.t === r.t)).filter(Boolean));   // the contenders only
    }
    async function preferApply(top) {
      const want = { measured: roadPrefs.measured, novel: roadPrefs.novel, crew: roadPrefs.crew };
      if (!window.ApexPrefer || !(want.measured || want.novel || want.crew)) return;
      const g = await preferGrids(want);
      for (const c of top) {
        const f = { measured: c.t.measured && Number.isFinite(c.t.measured.coverage) ? c.t.measured.coverage : null,
                    driven: g.driven ? ApexPrefer.share(c.t, g.driven) ?? 0 : null, crew: g.crew && g.crew.size ? ApexPrefer.share(c.t, g.crew) : null };
        c.preferBonus = ApexPrefer.bonus(want, f);
      }
    }
    // Your taste (taste.js, IDEAS R-33): with five or more "which road was better?" answers, each candidate's TECH, FLOW and
    // known smoothness from the reference lap, and a few fun points toward what you pick. No answers: nothing changes.
    function tasteOn(pool) {
      const t = window.ApexTaste && !(window.ApexFlags && !ApexFlags.on('taste_ranking')) ? ApexTaste.fit(ApexTaste.load(localStorage)) : null;
      if (!t) return;
      const top = rankPool(pool, funLevel).slice(0, 4).map(r => pool.find(c => c.t === r.t)).filter(Boolean);   // the contenders only
      for (const c of top) { try { c.tasteBonus = ApexTaste.bonus(t, ApexTaste.featuresOf(Core, c.t, { quick: true })); } catch (_) { c.tasteBonus = 0; } }
    }
    // Weather along the route (route_weather.js, IDEAS R-21): Open-Meteo's forecast at six points, for the hour you'd reach
    // each if you left now (the router's times). Said on the route card; nothing when the forecast can't be had.
    async function attachWeather(t) {
      $('routeCardWeather').hidden = true;
      if (!t || !Array.isArray(t.dist) || t.dist.length < 2 || !window.ApexRouteWeather) return;
      const total = t.dist[t.dist.length - 1];
      const secAt = Number.isFinite(t.timeS) ? (m) => t.timeS - ApexEta.routerLeft(m, total, t.timeS, t.timeMarks) : null;
      const pts = ApexRouteWeather.samplePoints(t, leaveAt(), secAt);
      let json = null, why = 'none';
      try {
        const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 8000);
        const r = await fetch(ApexRouteWeather.url(pts), { signal: ac.signal });
        clearTimeout(timer);
        json = r.ok ? await r.json() : null;
      } catch (e) { json = null; why = e && e.name === 'AbortError' ? 'slow' : 'signal'; }
      if (plannedRoute !== t) return;
      // unknown stays unknown, and the card says so (offline: our tiles still plan the route, but nothing live is known)
      if (!json) {
        const offline = why === 'signal' || navigator.onLine === false;
        $('routeCardWeather').textContent = offline ? 'Weather not known · no signal' : 'Weather not known';   // TestFlight 2026-11-12: a line, not a sentence
        $('routeCardWeather').hidden = false;
        return;
      }
      const line = ApexRouteWeather.summary(ApexRouteWeather.atArrival(json, pts),
        { dist: (m) => ApexUnits.long(m, 0), time: (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });
      $('routeCardWeather').textContent = line;
      $('routeCardWeather').hidden = !line;
    }
    // When to go (when_to_go.js, docs/ROUTING.md): the route on the card driven at every half hour of the next day, with the
    // route engine's own model: the sun, the forecast, deer hours, school runs, events, works and timed closures at that
    // hour. The card says the best time in a line (or that there is none better, or the last good one before rain); a tap
    // opens the day as a ribbon, and "Plan for 6:30 PM" plans the trip for that hour (leaveAtMs): the ranking, the forecast
    // line and the closures are then that hour's. It runs after the card is up and never holds it (WHEN_AFTER_MS).
    const WHEN_AFTER_MS = 1200;
    let whenState = null, whenTimer = 0, whenAbort = null;
    // "2:00 PM tomorrow": the day after the hour, so every sentence it goes into reads ("Better at 2:00 PM tomorrow", not
    // "Better at tomorrow 2:00 PM"; TestFlight sweep 2026-11-13)
    const whenClock = (ms) => `${new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${new Date(ms).toDateString() === new Date().toDateString() ? '' : ' tomorrow'}`;
    function whenReset() {
      clearTimeout(whenTimer);
      if (whenAbort) whenAbort.abort();
      whenAbort = null; whenState = null;
      $('routeCardWhen').hidden = true; $('routeWhenPanel').hidden = true; $('routeWhenLine').setAttribute('aria-expanded', 'false');
    }
    // Stop signs, railway crossings, one-lane bridges, speed bumps, deer crossings, gravel and rough road from the route's
    // context (road_marks.js): note events read with the pace notes and pinned on the map. None without a context (no
    // invented marks). The map's answer (Overpass) comes off the plan's critical path (osm_overpass.js WAIT_MS: a plan never
    // waits for it; the late answer is kept for the next ask), so until it has answered for this route it asks again for this
    // route alone, up to three times; what the tiles gave meanwhile (gravel) stays, and each answer only adds marks.
    function attachMarks(t, c, tries = 0) {
      if (!window.ApexRoadMarks || t.marksFromMap) return;
      const before = (t.marks || []).length;
      t.marks = ApexRoadMarks.union(t.marks, ApexRoadMarks.events(c.ctx, c.corridor, t, (la, lo, lats, lons) => Core.nearestIndex(la, lo, lats, lons, -1)));
      if (track === t && t.marks.length > before) { loadTrackOnMap(); render(false); }
      if (ApexRoadMarks.mapAnswered(c.ctx)) { t.marksFromMap = true; return; }
      if (tries >= 3) return;   // (three asks at most; a kept answer costs no request)
      setTimeout(async () => {
        if (plannedRoute !== t) return;
        const again = { t, route: { coords: Array.from(t.lat, (la, i) => [t.lon[i], la]), times: null }, timeS: t.timeS };
        await contextOn([again], CTX_BUDGET_MS, 'marks', ['osm_overpass']);
        if (plannedRoute === t && again.ctx && again.corridor) attachMarks(t, again, tries + 1);
      }, 4000 * (tries + 1));
    }
    // A route built during a drive (a reroute, a new destination) gets no When to go scan, so it asks for the marks itself:
    // the ranked candidate's context when it has one, else the map's answer for this route alone. Off the launch path.
    function attachMarksSoon(t) {
      if (!window.ApexRoadMarks || !t || !Array.isArray(t.lat) || t.lat.length < 2 || state.mode !== 'live') return;
      setTimeout(async () => {
        if (plannedRoute !== t || t.marksFromMap) return;
        const o = routeOptions, kept = o && o.current === t && o.list ? o.list[o.picked] : null;
        if (kept && kept.ctx && kept.corridor) { attachMarks(t, kept); return; }
        const c = { t, route: { coords: Array.from(t.lat, (la, i) => [t.lon[i], la]), times: null }, timeS: t.timeS };
        await contextOn([c], CTX_BUDGET_MS, 'marks', ['osm_overpass']);
        if (plannedRoute === t && c.ctx && c.corridor) attachMarks(t, c);
      }, 1500);
    }
    function attachWhen(t) {
      whenReset();
      if (!window.ApexWhenToGo || !window.ApexRouteEngine || !window.ApexRouteCtx || !t || !Array.isArray(t.lat) || t.lat.length < 2 || !Number.isFinite(t.timeS) || state.mode === 'live') return;
      if (window.ApexFlags && (!ApexFlags.on('route_engine') || !ApexFlags.on('when_to_go'))) return;
      whenTimer = setTimeout(() => { whenScan(t).catch(() => {}); }, WHEN_AFTER_MS);
    }
    async function whenScan(t) {
      if (plannedRoute !== t || state.mode === 'live') return;
      const ac = whenAbort = new AbortController();
      // the ranked candidate on the card has its corridor and context already; a loop, a GPX or a restored route gets one now
      const o = routeOptions, kept = o && o.current === t && o.list ? o.list[o.picked] : null;
      const c = kept && kept.corridor && kept.ctx ? kept : { t, route: { coords: Array.from(t.lat, (la, i) => [t.lon[i], la]), times: null }, timeS: t.timeS, fun: t.fun || null };
      if (!c.ctx) await contextOn([c], CTX_BUDGET_MS, 'when');
      if (plannedRoute !== t || ac.signal.aborted || !c.ctx || !c.corridor) return;
      attachMarks(t, c);
      let sc = null;
      try {
        await needCtx();
        sc = await ApexWhenToGo.scan(c, { now: Date.now(), prefs: engineOpts(funLevel).prefs, car: routingCar(), settings: routeCtxSettings(), providerOpts: routeCtxOpts(),
          signal: ac.signal, breathe: () => RouteLoading.yieldToUI() });
      } catch (_) { sc = null; }
      if (!sc || plannedRoute !== t || ac.signal.aborted) return;
      const planned = leaveAtMs && leaveAtMs > Date.now() ? sc.slots.slice(1).reduce((a, b) => (Math.abs(b.at - leaveAtMs) < Math.abs(a.at - leaveAtMs) ? b : a), sc.slots[1] || sc.now) : null;
      const advice = ApexWhenToGo.advice(sc, { time: whenClock });
      whenState = { t, sc, advice, planned, pick: planned || (advice && advice.slot) || sc.now };
      if (window.apexDebug) window.apexDebug.lastWhen = { advice: advice && { kind: advice.kind, text: advice.text }, slots: sc.slots.length, forecast: sc.forecast, planned: planned ? planned.at : null, status: sc.status };
      paintWhen();
    }
    function paintWhen() {
      const w = whenState;
      if (!w || plannedRoute !== w.t) return;
      const A = ApexWhenToGo, cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
      const lead = w.planned ? `Leaving ${whenClock(w.planned.at)}${((r) => (r.length ? `: ${r.join(', ')}` : ''))(A.reasons(w.planned).slice(0, 3))}` : w.advice ? w.advice.text : '';
      $('routeWhenLine').textContent = lead;
      $('routeCardWhen').hidden = !lead;
      if (!lead) return;
      const h = A.heights(w.sc), ribbon = $('routeWhenRibbon'), axis = $('routeWhenAxis');
      ribbon.textContent = ''; axis.textContent = '';
      const n = w.sc.slots.length;
      w.sc.slots.forEach((s, k) => {
        const b = document.createElement('button'), bar = document.createElement('i');
        b.type = 'button'; b.setAttribute('role', 'option'); b.dataset.k = String(k); b.setAttribute('aria-selected', String(s === w.pick));
        b.className = [s.hard.length ? 'shut' : '', s.dark != null && s.dark >= 0.7 ? 'night' : ''].filter(Boolean).join(' ');
        b.style.setProperty('--h', h[k].toFixed(2));
        b.setAttribute('aria-label', `${k === 0 ? 'Now' : whenClock(s.at)}: ${A.reasons(s).join(', ') || 'nothing in the way'}`);
        b.tabIndex = s === w.pick ? 0 : -1;
        b.append(bar); ribbon.append(b);
        const d = new Date(s.at);
        if (k === 0 || (d.getMinutes() === 0 && d.getHours() % 6 === 0 && k > 2)) {
          const tick = document.createElement('span');
          tick.textContent = k === 0 ? 'Now' : d.getHours() === 0 ? 'Midnight' : d.getHours() === 12 ? 'Noon' : d.toLocaleTimeString([], { hour: 'numeric' });
          tick.style.left = `${((k + 0.5) / n * 100).toFixed(1)}%`;
          axis.append(tick);
        }
      });
      // a label near the right end (Midnight on a phone, CI 2026-11-11) is set flush right inside the axis, never past it;
      // one that would then touch the label before it goes
      const ar = axis.getBoundingClientRect();
      let prevRight = -Infinity;
      for (const tick of [...axis.children]) {
        if (tick.getBoundingClientRect().right > ar.right) Object.assign(tick.style, { left: 'auto', right: '0', transform: 'none' });
        const r = tick.getBoundingClientRect();
        if (r.left < prevRight + 4) { tick.remove(); continue; }
        prevRight = r.right;
      }
      const p = w.pick, isNow = p === w.sc.now;
      const said = A.reasons(p), vsNow = !isNow && Math.abs(p.delta) >= 1 ? A.reasons(p, w.sc.now) : [];
      const det = $('routeWhenDetail'); det.textContent = '';
      const head = document.createElement('b');
      head.textContent = `${isNow ? 'Leave now' : cap(whenClock(p.at))}, there by ${new Date(p.arriveAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      det.append(head, said.length ? `: ${said.join(', ')}.` : '.',
        vsNow.length ? ` ${p.delta > 0 ? 'Better' : 'Worse'} than now: ${vsNow.join(', ')}.` : '', !w.sc.forecast ? ' No forecast came back: this is by the sun and the calendar only.' : '');
      const plan = $('routeWhenPlan'), same = w.planned ? p === w.planned : isNow;
      plan.hidden = same || p.hard.length > 0;
      plan.textContent = isNow ? 'Plan for now' : `Plan for ${whenClock(p.at)}`;
      $('routeWhenNow').hidden = !w.planned || isNow;
    }
    function planFor(at) {
      leaveAtMs = at && at - Date.now() > 5 * 60e3 ? at : null;
      const t = plannedRoute;
      if (!t || state.mode === 'live') return;
      const head = leaveAtMs ? `Planned for ${whenClock(leaveAtMs)}` : 'Planned for leaving now';
      // a trip to a place is ranked again for that hour (another road may be the better one then); a loop, a GPX or a route
      // with your own stop keeps its line and gets that hour's sun, forecast and closures
      if (t.id === 'route_dest' && t.request && !t.request.via.some((v) => !v.shaping)) { replanForLevel(head); return; }
      const g = FunRoute.glare(t, t.timeS, new Date(leaveAt()));
      t.glareMin = g ? Math.round(g.minutes) : null;
      renderRouteCard(t); attachWeather(t); attachClosures(t); attachWhen(t);
      cardNote(head);
    }
    $('routeWhenLine').addEventListener('click', () => {
      const open = $('routeWhenPanel').hidden;
      $('routeWhenPanel').hidden = !open; $('routeWhenLine').setAttribute('aria-expanded', String(open));
    });
    $('routeWhenRibbon').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b || !whenState) return;
      whenState.pick = whenState.sc.slots[+b.dataset.k]; paintWhen();
      const again = $('routeWhenRibbon').querySelector('[aria-selected="true"]'); if (again) again.focus({ preventScroll: true });
    });
    $('routeWhenRibbon').addEventListener('keydown', (e) => {
      if (!whenState || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const list = whenState.sc.slots, i = list.indexOf(whenState.pick);
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      e.preventDefault(); whenState.pick = list[j]; paintWhen();
      const again = $('routeWhenRibbon').querySelector('[aria-selected="true"]'); if (again) again.focus({ preventScroll: true });
    });
    $('routeWhenPlan').addEventListener('click', () => { if (whenState) planFor(whenState.pick === whenState.sc.now ? null : whenState.pick.at); });
    $('routeWhenNow').addEventListener('click', () => planFor(null));
    // The route's climb (stages.js profile, IDEAS U-21): its elevation from the DEM, so Preview's scrubber shows the hills
    // and the card says how much it climbs. A long trip or no tiles: unknown, nothing shown.
    async function attachProfile(t) {
      $('routeCardClimb').hidden = true; $('routeCardDescent').hidden = true;
      const none = () => { if (!t) return; t.profileDone = true; if (plannedRoute === t && !t.elev) $('routeCardProfile').classList.add('none'); };
      if (!t || t.elev || !window.ApexStages || !ApexStages.profile) { if (t && t.elev) paintClimb(t); else none(); return; }
      let elev = null;
      try { elev = await RouteLoading.optional(ApexStages.profile(t), 15000); } catch (_) { elev = null; }
      if (!elev) { none(); return; }
      if (plannedRoute !== t) return;
      t.elev = elev;
      paintClimb(t);
      if (track === t) drawScrubber();
    }
    // What kind of road where (road_page.js character, IDEAS Q-05): adaptive sectors read by the reference lap.
    function attachCharacter(t) {
      $('routeCardCharacter').hidden = true;
      if (!t || !window.ApexRoadPage || t.kind !== 'route') return;
      try {
        const breaks = (Array.isArray(t.steps) ? t.steps : []).map(s => Math.round((s.m || 0) / 5));
        t.character = ApexRoadPage.character(Core, t, breaks);
        const line = ApexRoadPage.characterLine(t.character, (m) => ApexUnits.long(m, 1));
        // U-134: no unit alone on a line; finding 9: the kinds of road in plain words ("S-bends", not "Esses")
        $('routeCardCharacter').textContent = line ? ApexRouteCard.factText(`Ahead: ${VOC ? VOC.plainRoads(line) : line}`) : '';
        $('routeCardCharacter').hidden = !line;
      } catch (_) { /* unknown: nothing said */ }
    }
    // What this drive is like (route_story.js, the owner 2026-11-09): a few plain lines from what the ranking already holds
    // for the route (its samples, context, corners, steps), worked out after the card is up and kept on the track; the
    // first line in view, the rest under it. A route with no ranking behind it (restored, a GPX, a loop): nothing said.
    function paintStory(t, again) {
      const box = $('routeCardStory');
      if (!box) return;
      if (again && (plannedRoute !== t || !t.__story)) return;         // only a card already painted for this route is refreshed
      const c = t && t.ranked, metric = ApexUnits.metric();
      const show = (s) => {
        const lines = s && Array.isArray(s.lines) ? s.lines : [];
        box.hidden = !lines.length;
        if (!lines.length) return;
        $('routeCardStoryLead').textContent = lines[0].text;
        $('routeCardStoryMore').replaceChildren(...lines.slice(1).map((l) => { const p = document.createElement('p'); p.textContent = l.text; return p; }));
        box.classList.toggle('one', lines.length === 1);
      };
      const kept = t && t.__story;
      if (!again && kept && kept.steps === t.steps && kept.metric === metric) { show(kept.s); return; }
      if (!again) box.hidden = true;                                   // a refresh keeps the lines up until the new ones are built
      if (!c || !window.ApexRouteStory) return;
      setTimeout(() => {
        if (plannedRoute !== t) return;
        let s = null;
        // the road you set off on: the router's depart maneuver names it, and the track's steps start at the first turn
        const dep = c.route && Array.isArray(c.route.steps) && c.route.steps[0] && c.route.steps[0].type >= 1 && c.route.steps[0].type <= 3 ? c.route.steps[0].street : null;
        const steps = dep && Array.isArray(t.steps) && !(t.steps[0] && t.steps[0].m <= 0) ? [{ m: 0, street: dep }, ...t.steps] : t.steps;
        try { s = ApexRouteStory.build(c, { metric, steps, track: t, glareMin: t.glareMin }); } catch (_) { s = null; }   // unknown: nothing said
        Object.defineProperty(t, '__story', { value: { steps: t.steps, metric, s }, configurable: true, writable: true, enumerable: false });
        if (plannedRoute === t) show(s);
      }, 0);
    }
    // Said to screen readers only, for what the screen already shows (the route bar after a route is found).
    function announce(text) { const a = $('announcer'); a.textContent = ''; setTimeout(() => { a.textContent = text; }, 50); }
    function heightLabel(m) { return ApexUnits.metric() ? `${Math.round(m)} m` : `${Math.round(m * 3.28084).toLocaleString('en-US')} ft`; }
    function paintClimb(t) {
      const up = ApexStages.climbM(t.elev), lo = Math.min(...t.elev), hi = Math.max(...t.elev);
      if (plannedRoute === t) paintProfile(t);
      if (up == null) return;
      const h = heightLabel;
      $('routeCardClimb').textContent = ApexRouteCard.factText(`Climbs ${h(up)} in all · highest ${h(hi)}`);
      $('routeCardClimb').hidden = false;
      // a long, steep descent on the way (brake_heat.js longDescents, from the same terrain): said before you set off
      t.descents = window.ApexBrakeHeat ? ApexBrakeHeat.longDescents(t.dist, t.elev) : [];    // also said near each top (notes loop)
      const fall = window.ApexBrakeHeat ? ApexBrakeHeat.descentText(t.descents, (m) => ApexUnits.long(m, 1), h) : null;
      $('routeCardDescent').textContent = fall ? ApexRouteCard.factText(fall) : ''; $('routeCardDescent').hidden = !fall;
      if (car.route && track === t) carAlong(t);                      // and on the car's route preview
    }
    // the owner, 2026-11-11: the places behind the Along line by name, a tap away (scenic.js places)
    const placeUnits = { long: (m) => ApexUnits.long(m, 1, true), short: (m) => { const d = ApexUnits.short(m); return `${d.n} ${d.u.toLowerCase()}`; } };
    function offerPlace(t, row) {
      const label = row.named ? row.title : row.kindName;
      toast(ApexScenic.placeLine(row), { label: 'Add as a stop', ms: 6000, onClick: () => { if (plannedRoute === t) addViaAt({ lat: row.lat, lon: row.lon, label }, row.m); } });
    }
    function paintAlongPanel(t, rows) {
      const panel = $('routeAlongPanel');
      panel.replaceChildren(...rows.map((row) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = `place${row.named ? '' : ' unnamed'}`; b.setAttribute('role', 'listitem');
        const name = document.createElement('b'); name.textContent = row.title;
        const at = document.createElement('span'); at.textContent = ApexRouteCard.factText(row.at);
        const sub = document.createElement('small'); sub.textContent = ApexRouteCard.factText([row.named ? row.kindName : '', row.off].filter(Boolean).join(' · '));
        b.append(name, at, sub);
        b.addEventListener('click', () => {
          if (mapReady) map.flyTo({ center: [row.lon, row.lat], zoom: Math.max(map.getZoom(), 14), duration: 900 });
          offerPlace(t, row);
        });
        return b;
      }));
      alongHours(t, rows);
    }
    // each named place's hours when you'd get there (place_info.js, one request for the list): the route's time spread
    // over its length; "On arrival" once that is a quarter hour or more away. Unknown says nothing.
    function alongHours(t, rows) {
      if (!window.ApexPlaceInfo || !rows.some((r) => r.named)) return;
      ApexPlaceInfo.lookupMany(rows.map((r) => (r.named ? { name: r.title, lat: r.lat, lon: r.lon } : null))).then((tags) => {
        if (plannedRoute !== t || !tags) return;
        const total = t.dist[t.dist.length - 1], subs = $('routeAlongPanel').querySelectorAll('.place small');
        tags.forEach((tg, i) => {
          const r = rows[i], el = subs[i];
          if (!tg || !el || !r) return;
          const s = Number.isFinite(t.timeS) && total > 0 && Number.isFinite(r.m) ? t.timeS * r.m / total : 0;
          const h = ApexPlaceInfo.contact(tg, new Date(Date.now() + s * 1000)).hours;
          if (h) el.textContent = ApexRouteCard.factText([el.textContent, `${s >= 900 ? 'On arrival: ' : ''}${h.text}`].filter(Boolean).join(' · '));
        });
      }).catch(() => {});
    }
    $('routeAlongLine').addEventListener('click', () => {
      const open = $('routeAlongPanel').hidden && $('routeAlongPanel').childElementCount > 0;
      $('routeAlongPanel').hidden = !open; $('routeAlongLine').setAttribute('aria-expanded', String(open));
    });
    function clearScenic() {
      for (const mk of scenicPins.splice(0)) mk.remove();
      fuelPins.length = 0; poiDeclutter.pins = [];
      $('routeCardAlong').hidden = true; $('routeAlongPanel').hidden = true; $('routeAlongPanel').replaceChildren();
      $('routeAlongLine').setAttribute('aria-expanded', 'false');
    }
    // IDEAS R-24: waterfalls near the route, from OpenStreetMap through Overpass (the map's tiles have none). A trip over 1°
    // across, the servers down or offline: none, and the Along line says what the tiles gave.
    async function fallsNear(t) {
      if (!window.ApexCameras || !ApexScenic.fallsQuery) return [];
      let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
      for (let i = 0; i < t.lat.length; i++) { s = Math.min(s, t.lat[i]); n = Math.max(n, t.lat[i]); w = Math.min(w, t.lon[i]); e = Math.max(e, t.lon[i]); }
      if (n - s > 1 || e - w > 1) return [];
      try {
        const json = await ApexCameras.fetchFirst(fetch, 'data=' + encodeURIComponent(ApexScenic.fallsQuery(s - 0.005, w - 0.005, n + 0.005, e + 0.005)));
        return ApexScenic.fallsFrom(json);
      } catch (_) { return []; }
    }
    async function attachScenic(t) {
      clearScenic();
      if (!t || !Array.isArray(t.lat) || t.lat.length < 2 || !window.ApexScenic) return;
      const pts = [];
      for (let i = 0; i < t.lat.length; i += 200) pts.push({ lat: t.lat[i], lon: t.lon[i] });   // every 1 km
      const falls = fallsNear(t);                                                              // asked at once, painted when it lands
      let raw = null;
      try { raw = await ApexStages.pois(pts); } catch (_) { raw = null; }                     // offline or a very long route
      if (raw && ApexScenic.forCar) raw = ApexScenic.forCar(raw, routingCar());               // an EV's chargers, any other car's pumps
      if (plannedRoute !== t) return;                                                          // another route came up meanwhile
      if (!raw) return;                                                                        // say nothing: no fuel known is not "no fuel"
      paintScenic(t, ApexScenic.along(raw, t));
      const wf = await falls;
      if (plannedRoute !== t || !wf.length) return;
      clearScenic();
      paintScenic(t, ApexScenic.along(raw.concat(wf), t));                                     // the waterfalls join the tiles' places
    }
    function paintScenic(t, list) {
      t.scenic = list;
      if (car.route && track === t) carAlong(t);
      const ev = !!(routingCar() && routingCar().fuel === 'electric');
      const line = ApexScenic.summary(list, t.dist[t.dist.length - 1], { electric: ev });
      const rows = ApexScenic.places(list, placeUnits);
      $('routeAlongLine').textContent = ApexRouteCard.factText(line); $('routeCardAlong').hidden = !line;
      $('routeAlongLine').disabled = !rows.length;                                               // only a fuel warning: nothing to list
      $('routeCardAlong').dataset.glyph = ApexRouteCard.alongGlyph(line);                     // U-134: a café is a cup
      paintAlongPanel(t, rows);
      for (const p of list) {
        const row = ApexScenic.places([p], placeUnits)[0];
        const el = document.createElement('div'); el.className = `poi-pin poi-${p.kind}`;
        // the owner, 2026-11-12 (TestFlight): "bird watching shelter blocks half the route". A viewpoint is a VIEW stamp like
        // a café or fuel stop; its name is a tap away, and on the stamp only close in (declutterPois, VIEW_NAME_ZOOM)
        el.textContent = SCENIC_LABEL[p.kind];
        el.title = p.name || SCENIC_LABEL[p.kind];
        // tap a viewpoint, café or fuel stop on the map: its name, and it can be a stop of the day (IDEAS R-17)
        el.addEventListener('click', (e) => { e.stopPropagation(); if (row) offerPlace(t, row); });
        const mk = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
        el.setAttribute('role', 'button'); el.setAttribute('aria-label', row ? ApexScenic.placeLine(row) : SCENIC_LABEL[p.kind]);   // after the Marker's own "Map marker"
        scenicPins.push(mk);
        poiDeclutter.pins.push({ marker: mk, el, kind: p.kind, named: !!p.name, name: p.name || null, m: p.m });
        if ((p.kind === 'fuel' || p.kind === 'charge') && Number.isFinite(p.m)) fuelPins.push({ m: p.m, el, name: p.name || null });
      }
      fuelPins.sort((a, b) => a.m - b.m);
      updatePins();
      declutterSoon();
    }
    function paintReported() {
      const keep = new Set(reported.list.map(h => h.id));
      for (const [id, mk] of reported.pins) if (!keep.has(id)) { mk.remove(); reported.pins.delete(id); }
      for (const h of reported.list) {
        if (reported.pins.has(h.id)) continue;
        const el = document.createElement('div'); el.className = h.official ? 'hz-pin hz-dot' : 'hz-pin';   // a DOT's event: its own word
        el.textContent = ((h.official && h.label) || ApexHazardReports.LABEL[h.kind] || 'Hazard').toUpperCase();
        reported.pins.set(h.id, new maplibregl.Marker({ element: el }).setLngLat([h.lon, h.lat]).addTo(map));
      }
    }
    // Each fresh fix while driving: call the next reported hazard ahead, and after passing one ask if it's still there.
    // ---- crash check (IDEAS D-17; web/incident.js): impact + stop asks "Are you OK?"; the contact is local only ----------
    const CRASH_KEY = 'apex.crashContact';
    const crashContact = () => { try { const c = JSON.parse(localStorage.getItem(CRASH_KEY) || 'null'); return c && c.phone ? c : null; } catch (_) { return null; } };
    (() => {
      const c = crashContact() || {};
      $('crashName').value = c.name || ''; $('crashPhone').value = c.phone || '';
      const save = () => {
        const name = $('crashName').value.trim().slice(0, 40), phone = $('crashPhone').value.trim().slice(0, 24);
        try { if (phone) localStorage.setItem(CRASH_KEY, JSON.stringify({ name, phone })); else localStorage.removeItem(CRASH_KEY); } catch (_) {}
      };
      $('crashName').addEventListener('change', save); $('crashPhone').addEventListener('change', save);
      // U-117: the switch says what it does in the state it is in. With no contact it still asks and offers the emergency
      // call (it never calls by itself); a contact adds the text with your location.
      const paint = () => {
        const n = $('crashState'); if (!n) return;
        const num = window.ApexIncident ? ApexIncident.emergencyNumber(navigator.language) : '911';
        const who = $('crashName').value.trim(), has = !!$('crashPhone').value.trim();
        n.textContent = !state.toggles.crash ? 'Off. Nothing is checked after an impact.'
          : has ? `On. After a hard impact and a stop it asks if you're OK, then offers to call ${num} or text ${who || 'your contact'} where you are.`
          : `On, with no contact: after a hard impact and a stop it asks if you're OK, then offers to call ${num}. Add a contact to text them where you are too.`;
      };
      $('crashName').addEventListener('input', paint); $('crashPhone').addEventListener('input', paint);
      document.querySelectorAll('[data-toggle="crash"]').forEach((k) => k.addEventListener('click', paint));
      paint();
    })();
    const crashSheet = window.ApexIncident ? ApexIncident.mount({ el, say: (t) => say(t, true), haptic, contact: crashContact, position: () => state.lastPosition || null }) : null;
    const crashDetector = window.ApexIncident ? ApexIncident.createDetector() : null;
    function feedCrash(frame) {
      if (!crashDetector || !crashSheet || !state.toggles.crash) return;   // the native shell sends no frames here outside a drive
      const t = Number.isFinite(frame.t) ? frame.t : Date.now();
      if (crashDetector.update({ t, speed_mps: frame.speed_mps, impact_g: frame.impact_g }) === 'ask') { crashSheet.ask(); health.bump('crash_asked'); }
    }
    // Reports and answers made with no signal wait here and go when it's back (IDEAS F-05; web/outbox.js).
    const outbox = ApexOutbox.createOutbox(localStorage, async (path, b) => {
      const r = await ApexSync.apiFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      return r.status;
    });
    let outboxAt = 0;
    const flushOutbox = () => { outboxAt = performance.now(); if (navigator.onLine === false || window.APEX_REVIEW) return; outbox.flush().then((n) => { if (!n) return; health.bump('hazard_sent_late', n); toast(n === 1 ? 'Sent what waited for signal.' : `Sent ${n} things that waited for signal.`); loadReported(true); }).catch(() => {}); };
    window.addEventListener('online', flushOutbox);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushOutbox(); });
    if (outbox.size()) setTimeout(flushOutbox, 3000);
    function feedReported(frame) {
      if (outbox.size() && performance.now() - outboxAt > 60000) flushOutbox();   // a fix and a minute since the last try
      if (!driveActive && state.mode !== 'live') { lookupEdge.on = false; return; }
      if (!lookupEdge.on) Object.assign(lookupEdge, { on: true, m: 0, last: null, edgeM: Math.max(1000, window.ApexContributor ? ApexContributor.privateEdge() * 5 : 0) });
      if (lookupEdge.last) lookupEdge.m += ApexPrivacyZones.metres(lookupEdge.last.lat, lookupEdge.last.lon, frame.lat, frame.lon);
      lookupEdge.last = { lat: frame.lat, lon: frame.lon };
      loadReported();
      loadRoadEvents().catch(() => {}); mergeRoadEvents();
      const me = { lat: frame.lat, lon: frame.lon, heading: Number.isFinite(frame.course_deg) ? frame.course_deg : null };
      const v = Number.isFinite(frame.speed_mps) ? frame.speed_mps : 0;
      const next = ApexHazardReports.nextAhead(reported.list, me, Math.max(150, Math.min(600, v * 8)), reported.said);
      paintHazardPlate(ApexHazardReports.nextAhead(reported.list, me, HZ_PLATE_M, null));
      if (next) { reported.said.add(next.id); say(next.text, false, null, null, { kind: 'hazard', key: `rep:${next.id}`, repeatMs: 10 * 60000, alert: true,
        tokens: [!next.label && ApexVoiceLines.TEXT[`line:rep_${next.kind}`] ? `line:rep_${next.kind}` : 'line:rep_hazard'], named: !!next.label }); }
      try { policeAheadTick(me); } catch (_) { /* never in the way of the drive */ }
      try { closedAheadTick(me); } catch (_) { /* never in the way of the drive */ }
      try { dotAheadTick(me); } catch (_) { /* never in the way of the drive */ }
      const passed = reported.watch.update(reported.list, me, reported.mine);
      if (passed && !reported.asking) askStill(passed);
    }
    // The hazard plate (REVIEW.md 4.3): the nearest reported hazard ahead within a mile, fixed top-left of the map in every
    // theme, until it is passed. Its words are hazard_reports.js plate(): what, how far, how old, how many confirmed.
    const HZ_PLATE_M = 1609;
    function paintHazardPlate(h) {
      const p = h && state.mode === 'live' ? ApexHazardReports.plate(h, (m) => ApexUnits.long(m, 1), Date.now()) : null;
      if (p && $('hzPlate').hidden) state.blinkUntil = performance.now() + 1200;   // Kit blinks at a hazard (Tapedeck)
      if ($('hzPlate').hidden !== !p) $('hzPlate').hidden = !p;            // (written only on a change: this runs every fix)
      if (!p) return;
      if ($('hzPlateTitle').textContent !== p.title) $('hzPlateTitle').textContent = p.title;
      if ($('hzPlateDetail').textContent !== p.detail) $('hzPlateDetail').textContent = p.detail;
      const wrap = !!(h && h.words);                                     // a sign's own words wrap, up to three lines
      if ($('hzPlateDetail').classList.contains('wrap') !== wrap) $('hzPlateDetail').classList.toggle('wrap', wrap);
    }
    function askStill(h) {
      reported.asking = h;
      $('hzAskText').textContent = `${h.label || ApexHazardReports.LABEL[h.kind] || 'Hazard'} still there?`;
      carPost({ kind: 'ask', title: $('hzAskText').textContent });         // the car asks too, with Still there and Gone
      $('hzAsk').hidden = false;
      clearTimeout(reported.askTimer);
      reported.askTimer = setTimeout(() => { $('hzAsk').hidden = true; reported.asking = null; }, 12000);
    }
    async function answerStill(still) {
      const h = reported.asking; $('hzAsk').hidden = true; reported.asking = null; clearTimeout(reported.askTimer);
      if (!h) return;
      const path = `/api/hazards/${encodeURIComponent(h.id)}/vote`;
      let r = null;
      if (window.APEX_REVIEW) r = new Response(null, { status: 204 });   // U-94: the review recording's answer stays here
      else try { r = await ApexSync.apiFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ still }) }); } catch (_) {}
      if (!r || r.status >= 500) { outbox.add(path, { still }); toast('No signal. Your answer goes when you have one.'); return; }
      toast(still ? 'Thanks. Others will hear about it.' : 'Thanks. It goes once others agree.');
    }
    $('hzStill').addEventListener('click', () => answerStill(true));
    $('hzGone').addEventListener('click', () => answerStill(false));
    for (const k of ApexHazardReports.KINDS) {
      const b = document.createElement('button'); b.className = 'ink-btn hz-btn'; b.textContent = ApexHazardReports.LABEL[k];
      b.addEventListener('click', () => reportHazard(k));
      $('hzKinds').append(b);
    }
    // A Factory crew's own categories (REVIEW.md 5.1, e.g. "Cattle grid"): extra buttons for its members, sent as a labelled report.
    async function loadCrewHazardKinds() {
      document.querySelectorAll('#hzKinds .hz-custom').forEach((b) => b.remove());
      const list = accountMe && accountMe.member ? await apiCall('GET', '/api/hazards/kinds').then(jsonOf).catch(() => null) : null;
      for (const label of Array.isArray(list) ? list : []) {
        const b = document.createElement('button'); b.className = 'ink-btn hz-btn hz-custom'; b.textContent = label;
        b.addEventListener('click', () => reportHazard('debris', label));
        $('hzKinds').append(b);
      }
    }
    // One tap reports; for 3 s the Report key is Undo (REVIEW.md 1.2, Hazard report): nothing is sent until then.
    let pendingHz = null;
    function paintHzUndo() {
      const b = $('hzReportBtn');
      b.textContent = pendingHz ? `Undo ${pendingHz.body.label || ApexHazardReports.LABEL[pendingHz.body.kind] || 'report'}` : 'Report';
      b.setAttribute('aria-label', pendingHz ? 'Undo the hazard report' : 'Report a hazard');
      b.classList.toggle('undo', !!pendingHz);
    }
    $('hzReportBtn').addEventListener('click', () => {
      if (pendingHz) { undoHazard(); return; }
      $('hzOverlay').classList.add('show');
    });
    // the report waiting to go is not sent; its Undo on the car's screen, if it has one, goes too
    function undoHazard() {
      if (!pendingHz) return;
      clearTimeout(pendingHz.timer);
      if (pendingHz.carOffer) carPost({ kind: 'offerDone', id: pendingHz.carOffer });
      pendingHz = null; paintHzUndo(); toast('Not sent.');
    }
    $('hzCancel').addEventListener('click', () => $('hzOverlay').classList.remove('show'));
    // fromCar: reported on the car's Report grid. The car says so with its own Undo (a navigation alert, "Pothole reported",
    // Undo and OK), as the phone's Report key turns into Undo; its window is the car alert's shortest, CAR_HZ_UNDO_MS.
    const CAR_HZ_UNDO_MS = 5000;
    async function reportHazard(kind, label = null, fromCar = false) {
      $('hzOverlay').classList.remove('show');
      const p = state.lastPosition, heading = state.lastMotion && state.lastMotion.heading;
      if (!p || !state.lastPositionAt || performance.now() - state.lastPositionAt > 10000) { toast('No GPS fix yet. Try again in a moment.'); return; }
      const body = { kind, lat: p.lat, lon: p.lon, heading: Number.isFinite(heading) ? Math.round((heading % 360 + 360) % 360) : null, ...(label ? { label } : {}) };
      if (pendingHz) {                                                   // the one before goes now
        clearTimeout(pendingHz.timer); const was = pendingHz.body;
        if (pendingHz.carOffer) carPost({ kind: 'offerDone', id: pendingHz.carOffer });
        pendingHz = null; sendHazard(was);
      }
      const ms = fromCar ? CAR_HZ_UNDO_MS : 3000;
      const held = pendingHz = { body, timer: setTimeout(() => { const b = pendingHz && pendingHz.body; pendingHz = null; paintHzUndo(); if (b) sendHazard(b); }, ms) };
      paintHzUndo();
      if (fromCar) {
        const id = `o${++car.offerSerial}`, word = label || ApexHazardReports.LABEL[kind] || 'Hazard';
        held.carOffer = id;
        car.offer = { id, until: performance.now() + ms, run: () => { car.offer = null; if (pendingHz === held) undoHazard(); } };
        carPost(ApexCarPlay.offerMessage(id, `${word} reported`, '', 'Undo', ms, 'OK'));
      }
    }
    // U-94: in the review recording (window.APEX_REVIEW) a report is the member's sheet, Undo and pin, answered here as the
    // Worker would answer it; it never reaches the server or the outbox, so no real driver hears of a replayed drive's gravel.
    function reviewHazard(body) {
      const h = { id: `review_${Date.now()}`, kind: body.kind, label: body.label || null, lat: body.lat, lon: body.lon, heading: body.heading,
                  confirms: 1, clears: 0, created_at: new Date().toISOString() };
      reported.local.push(h); reported.list = reported.list.concat(h); paintReported(); carHazards();
      return new Response(JSON.stringify({ id: h.id, confirmed: false }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    async function sendHazard(body) {
      const kind = body.kind, word = body.label || ApexHazardReports.LABEL[kind];
      let r = null;
      if (window.APEX_REVIEW) r = reviewHazard(body);
      else try { r = await ApexSync.apiFetch('/api/hazards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch (_) {}
      if (!r || r.status >= 500) { outbox.add('/api/hazards', body, true); health.bump('hazard_queued'); toast(`No signal. ${word} saved; it's sent when you have one.`); return; }
      if (r.status === 401 || r.status === 403) { askSignIn('report hazards for others'); return; }
      if (!r.ok) { toast(r.status === 429 ? 'That\'s a lot of reports today.' : 'Couldn\'t send that. Try again.'); return; }
      const j = await r.json(); reported.mine.add(j.id); reported.said.add(j.id);
      toast(j.confirmed ? `${word}: someone reported it already. You confirmed it.` : `${word} reported. Drivers behind you will hear about it.`);
      loadReported(true);
    }

    // Road uploads counted for app health (Y-03): taken, or failed (to be retried or refused).
    const countedContribute = async (c) => { const r = await ApexSync.contribute(c); health.bump(r === true ? 'road_upload_ok' : 'road_upload_fail'); return r; };
    function feedAmbient(frame) {
      ambient.mounted = frame.calibration === 'locked';
      if (!window.ApexContributor || !window.ApexSensors) return;
      if (ambient.mounted) checkAmbientAllowed();
      if (!ambient.allowed) return;
      if (!ambient.sharer) {
        ambient.sharer = ApexContributor.createAmbient({
          makeRecorder: () => new ApexSensors.Recorder(),
          makeLive: () => { const day = new Date(); return ApexContributor.createLive({ Core, fetch: window.fetch.bind(window), post: countedContribute,
            deliberate: () => !!(drive.native && drive.rec),          // rows of a recorded drive say so: they count toward loved roads
            driveId: ApexContributor.driveIdFor({ id: `app_${Date.now()}`, date: day.toISOString() }), drivenOn: day.toISOString().slice(0, 10),
            hourBucket: () => (window.ApexFlags && ApexFlags.on('quiet_hours', false) ? ApexContributor.hourBucket(new Date()) : null) }); },
          onStatus: () => { paintAmbient(); if (state.mode === 'live') paintDriveStat(); },
        });
      }
      ambient.sharer.frame(frame);
    }
    window.addEventListener('pagehide', () => { if (ambient.sharer) ambient.sharer.stop(); });
    setInterval(paintAmbient, 5000);
    paintAmbient();
    async function startLiveSharing() {
      const rec = drive.rec;
      try {
        if (!window.ApexSync || !window.ApexContributor) return;
        // with no signal at the start (sync.js roadShare): the last answer the server gave; the road data then waits on the
        // phone (road_carry.js) and is sent only once the server says Road data is still on
        const sh = await ApexSync.roadShare();
        if (!sh.member) return;
        if (!sh.on) { drive.share = 'off-member'; paintDriveStat(); return; }
        if (drive.rec !== rec) return;                                       // the drive ended while we were checking
        const day = new Date(), pad = (n) => String(n).padStart(2, '0');
        drive.live = ApexContributor.createLive({
          Core, fetch: window.fetch.bind(window), post: countedContribute,
          driveId: ApexContributor.driveIdFor({ id: `live_${Date.now()}`, date: day.toISOString() }),
          drivenOn: day.toISOString().slice(0, 10),
          // route context: a recorded drive counts toward loved roads; busy times only with quiet_hours on (default off, OWNER_TODO)
          deliberate: true, hourBucket: () => (window.ApexFlags && ApexFlags.on('quiet_hours', false) ? ApexContributor.hourBucket(new Date()) : null),
          onStatus: (s) => { drive.share = s.state === 'stopped' ? 'stopped' : 'on'; drive.shareKm = s.km; drive.shareErr = s.error; if (s.error) console.warn('road data sharing:', s.error); paintDriveStat(); },
        });
        drive.share = 'on'; feedLive(); paintDriveStat();
      } catch (_) { /* sharing is optional: the drive itself is unaffected */ }
    }
    let driveActive = false;
    // The drive's Live Activity in the app (ApexNavApp.swift, IDEAS U-11): the next note, its distance and time left, on the
    // lock screen and in the Dynamic Island. Sent when the shown note changes, at most every 3 s otherwise.
    const liveAct = { on: false, last: '', at: 0 };
    // CarPlay (web/carplay.js, CarPlay/ApexCarPlay.swift): the car's screen gets the planned route, the next maneuver and
    // hazards; what the driver picks there comes back as onNative({type:'carplay'}). Only in the app.
    // a request made on the car (a loop, a place to go, a report): toast() says on the car too what it says meanwhile
    // the car's Places: pinned, this week's time attack loop (once entered), saved routes and recents, as Where to? lists
    // them (carplay.js placesMessage)
    function carPlaces() {
      let pinned = [], saved = [], attacks = [];
      try { pinned = ApexPinnedPlaces.list(localStorage); saved = ApexSavedRoutes.list(localStorage); } catch (_) {}
      try {
        // its length only: the board and your place on it stay on the phone (no scores or social features in the car,
        // docs/APP_REVIEW.md); the featured one says so, as the phone's row does
        attacks = car.attacks.map((c) => ({ id: c.segment_id, name: c.name,
          detail: [c.featured ? 'Featured' : '', Number.isFinite(c.length_m) ? ApexUnits.long(c.length_m, 1) : ''].filter(Boolean).join(' · ') }));
      } catch (_) {}
      // Nearby first (Apple Maps' Gas, Coffee and Food on the car): the phone's Find nearby kinds, an electric car's Chargers
      const nearby = window.ApexNearby ? ApexCarPlay.nearbyKeys(ApexNearby.keys(isElectric()), ApexNearby.CATS) : [];
      return { ...ApexCarPlay.placesMessage(recentPlaces(), pinned, saved, (m) => ApexUnits.long(m), attacks), nearby };
    }
    // Time attack's Drive it (time_attack.js, the phone's or the car's): the loop itself is the route, as a roadbook road is
    async function driveAttack(c, g) {
      closeSheet();
      const t = await trackFromPolyline(g.map(([la, lo]) => [lo, la]), `timeattack_${c.segment_id}`, c.name);
      await buildRoute(null, t.id, c.name, t);
      toast(`${c.name}: ${ApexUnits.long(totalM(), 1)}. The clock runs from the start line, as on any stage.`);
    }
    async function carAsked(run) { car.echo++; try { await run(); } catch (_) { /* each request says its own errors */ } finally { car.echo--; } }
    function carPost(msg) {
      const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex;
      if (native && msg) try { native.postMessage({ cmd: 'car', ...msg }); } catch (_) {}
    }
    function carRoute(t) {
      if (t && t === car.ended) t = null;                                 // U-62: a route just driven is not offered to the car again
      const o = routeOptions && t && routeOptions.current === t ? routeOptions : null;
      if (t && !t.carSerial) t.carSerial = ++car.serial;              // a reroute keeps the id (and may keep the length): still a new route
      const key = t ? `${t.id}|${t.carSerial}|${t.lat.length}|${o ? o.picked : -1}|${state.noteWords}` : '';   // M-3: the plates in the driver's words
      if (key === car.route) return;
      car.route = key;
      if (!t) { carPost({ kind: 'clear' }); carPost({ kind: 'corners', list: [] }); return; }
      carPost(ApexCarPlay.routeMessage(t, o ? o.list.map(c => ({ fun: c.fun, timeS: c.timeS, distM: c.t && c.t.dist ? c.t.dist[c.t.dist.length - 1] : null })) : null,
        o ? o.picked : 0, (m) => ApexUnits.long(m, 1)));
      carPost(ApexCarPlay.cornersMessage(t, (m) => sample(t, m), state.noteWords));        // the road book on the car's map (web/carmap.js)
      car.along = ''; carAlong(t);                                       // the car forgets the last route's places with it
      carHazards();                                                      // and its cameras
    }
    // The cafés and fuel along the route by name on the car's route preview (the owner, 2026-11-11). t.scenic comes later
    // than the route (attachScenic): it is sent then, and again with every route the car is sent.
    function carAlong(t) {
      if (!t || (!Array.isArray(t.scenic) && !Array.isArray(t.descents))) return;
      const fall = window.ApexBrakeHeat ? ApexBrakeHeat.descentShort(t.descents, (m) => ApexUnits.long(m, 1)) : null;
      const msg = ApexCarPlay.alongMessage(t.scenic || [], fall), key = `${car.route}|${JSON.stringify(msg)}`;
      if (key === car.along) return;
      car.along = key;
      carPost(msg);
    }
    // The theme and the voice switch for the car's screen: its map paints the theme, its guidance card takes the theme's dark.
    function carLook() {
      if (!look || !look.theme) return;
      const msg = ApexCarPlay.lookMessage(look.theme, !!state.toggles.voice, ApexUnits.system()), key = JSON.stringify(msg);
      if (key === car.look) return;
      car.look = key;
      carPost(msg);
    }
    // with the planned route's speed cameras (and plate readers) as plates, as Waze shows them on the car: the same switch as
    // the phone's camera notes (toggles.lpr), from map data (web/cameras.js), never a camera we weren't told of
    function carHazards() {
      const t = plannedRoute && car.route && Array.isArray(plannedRoute.alpr) && state.toggles.lpr ? plannedRoute : null;
      const msg = ApexCarPlay.hazardsMessage(reported.list, ApexHazardReports.LABEL, t ? t.alpr : null), key = msg.list.map((h) => h.id).join(',');
      if (key === car.hazards) return;
      car.hazards = key;
      carPost(msg);
    }
    // The turn's tulip as a PNG for the car's guidance card, drawn once per turn type and ink; the first guide message for a new
    // type goes without it (the shell shows its own symbol) and the next one, a second later, carries it.
    // Corners on the car's guidance card (web/carplay.js guideMessage): 'all' ratings, or 'tight' (1, 2, hairpins) if App
    // Review asks for turn-by-turn only (docs/APP_REVIEW.md, CarPlay row). One line to change; 'off' is turns alone.
    const CAR_CORNERS = 'all';
    // The tulip as a PNG for the car's card, drawn straight onto a canvas from the SVG's own path data (Path2D): no image
    // to load, so it is there in the first message, and nothing that could taint the canvas. (Loading the SVG as an image
    // never finished in the app: the car showed Apple's arrow, the owner's photos, 2026-10-29.)
    function tulipPNG(svg) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 120;
      const x = cv.getContext('2d'); x.scale(1.2, 1.2);                   // the SVG's 100-unit viewBox at 120 px
      x.strokeStyle = (svg.match(/stroke="([^"]+)"/) || [])[1] || '#EDE4D3';
      x.lineWidth = +(svg.match(/stroke-width="([\d.]+)"/) || [])[1] || 9; x.lineCap = 'round'; x.lineJoin = 'round';   // the hairpin's is thinner (U-78)
      for (const m of svg.matchAll(/<path d="([^"]+)"(?: fill="([^"]+)")?\/>/g)) {
        const path = new Path2D(m[1]);
        if (m[2]) { x.fillStyle = m[2]; x.fill(path); }
        x.stroke(path);
      }
      for (const m of svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"(?: fill="([^"]+)")?\/>/g)) {
        x.beginPath(); x.arc(+m[1], +m[2], +m[3], 0, 2 * Math.PI);
        if (m[4]) { x.fillStyle = m[4]; x.fill(); } else x.stroke();
      }
      return cv.toDataURL('image/png').split(',')[1];
    }
    function carSymbol(type, corner, recording) {
      const night = (look && look.theme && look.theme.night) || {}, ink = night.panelInk || '#EDE4D3', accent = night.accent || '#E65252';
      const key = recording ? `rec|${ink}|${accent}` : corner ? `c${corner.dir}${corner.sev}|${ink}` : `${type}|${ink}`;
      if (!car.symbols.has(key)) {
        let png = null;
        try { png = tulipPNG(recording ? ApexCarPlay.recordSVG(ink, accent) : corner ? ApexCarPlay.cornerTulipSVG(corner.dir, corner.sev, ink) : ApexCarPlay.tulipSVG(type, ink)); } catch (_) {}
        car.symbols.set(key, png);
      }
      return car.symbols.get(key);
    }
    // The junction's lanes for the car's guidance card (CarPlay/ApexCarPlay.swift junctionImage), a PNG drawn as the road
    // book's lane row (web/carplay.js laneGlyphs) in the card's ink: 105 pt by 30 at 3x, each lane a 24-unit box.
    function carLanes(packed) {
      const glyphs = ApexCarPlay.laneGlyphs(ApexLanes.lanes(packed));
      if (!glyphs.length) return null;
      const ink = ((look && look.theme && look.theme.night) || {}).panelInk || '#EDE4D3', key = `lanes|${JSON.stringify(packed)}|${ink}`;
      if (!car.symbols.has(key)) {
        let png = null;
        try {
          const cv = document.createElement('canvas'); cv.width = 315; cv.height = 90;
          const x = cv.getContext('2d'), u = Math.min(cv.height / 26, cv.width / (glyphs.length * 26));   // px per unit: 24 and a gap
          x.strokeStyle = ink; x.lineWidth = 2.6; x.lineCap = 'round'; x.lineJoin = 'round';
          const x0 = (cv.width - glyphs.length * 26 * u) / 2;
          glyphs.forEach((g, i) => {
            x.save(); x.globalAlpha = g.alpha;
            x.translate(x0 + (i + 0.5) * 26 * u, cv.height / 2); x.scale(u, u); x.rotate(g.rotate * Math.PI / 180);
            x.stroke(new Path2D(g.d)); x.restore();
          });
          png = cv.toDataURL('image/png').split(',')[1];
        } catch (_) { /* no canvas: the card goes without lanes */ }
        car.symbols.set(key, png);
      }
      return car.symbols.get(key);
    }
    // U-63: the road under the car for the continue step on a route with no named steps (a GPX track, a loop), read from the
    // map's own tiles (ApexRoadNames, as the saved drive's name is) at most every 5 s and only when a continue step asks.
    function carRoad() {
      const now = performance.now(), L = state.live;
      if (now - car.roadAt < 5000 || !L || !window.ApexRoadNames) return car.road;
      car.roadAt = now;
      try { car.road = ApexRoadNames.nearestRoadName(map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name' }), L.lat, L.lon) || ''; } catch (_) { /* style not loaded */ }
      return car.road;
    }
    // the card's turn is the voice's (turnProgress): the same one, in road order, never one taken coming back
    function carStep() {
      const i = track && Array.isArray(track.steps) ? turnProgress.at(track.steps, state.cursorM, track.id) : -1;
      return i >= 0 ? track.steps[i] : null;
    }
    function carGuide() {
      if (!driveActive) return;
      // off the route: the status line's words as the car's paused trip ("Rerouting…"), never the old turn frozen; back on it
      // (or on the new route) the key differs, so the next maneuver goes out at once
      // arrived: the last 40 m of a route to somewhere reached (a loop ends where it began, so it says nothing at its start);
      // it stays Arrived when the car drives on or off the route, never Rerouting to a place already reached
      const end = track && track.kind === 'route' && state.mode === 'live' ? totalM() : 0;
      if (end > 500 && Math.max(state.cursorM, routeWatch.bestM) > end - 40 && !String(track.id || '').startsWith('loop_')) {
        if (car.guideKey !== 'arrived') { car.guideKey = 'arrived'; car.guideAt = performance.now(); carPost(ApexCarPlay.arrivedMessage(track.name)); }
        return;
      }
      const off = track && track.kind === 'route' && state.mode === 'live' && state.cursorIdx < 0 ? ApexCarPlay.pausedMessage(offRouteText()) : null;
      if (off) { if (off.key !== car.guideKey) { car.guideKey = off.key; car.guideAt = performance.now(); carPost(off); } return; }
      // U-59: a drive with no route (or on the road ahead) is still a drive on the car: the record card and the distance driven
      const now = performance.now(), g = !track || track.kind !== 'route'
        ? ApexCarPlay.recordingMessage(drive.rec ? drive.rec.km * 1000 : null, (m) => ApexUnits.long(m, 1))
        : ApexCarPlay.guideMessage(track, state.cursorM, etaLeftS, ApexDirections.phrase,
          { corners: CAR_CORNERS, call: (e) => (state.noteWords === 'plain' && !e.recce && window.ApexPlainNotes ? ApexPlainNotes.plainCall(e) : e.call),
            plain: state.noteWords === 'plain' && !!window.ApexPlainNotes,   // U-112: the card's short words in the call's words
            speedMps: state.live ? state.live.speed_mps : null, road: carRoad, step: carStep() });
      if (!g || (g.key === car.guideKey && now - car.guideAt < 1000)) return;
      car.guideKey = g.key; car.guideAt = now;
      const sym = carSymbol(g.type, g.corner, g.recording), { lanes, ...msg } = g, ln = lanes ? carLanes(lanes) : null;
      carPost({ ...msg, ...(sym ? { symbol: sym } : {}), ...(ln ? { lanes: ln } : {}) });
    }
    function activity(action, fields = {}) {
      const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex;
      if (!native) return;
      if (action === 'start') liveAct.on = true;
      if (action === 'end') { liveAct.on = false; liveAct.last = ''; }   // always sent: the shell ends any left over, even one this page didn't start
      if (action === 'update' && !liveAct.on) return;
      try { native.postMessage({ cmd: 'activity', action, ...fields }); } catch (_) {}
    }
    // U-61: the Live Activity with no note ahead: a true short word for the island ('QUIET' on the route, the status
    // line's own words off it (U-103), 'REC' in a free drive) and a line that still says something: the next corner's distance when the route has one,
    // else how far you've driven. `distance` stays the note's own (empty here), so the island shows the record dot.
    function quietActivity() {
      const driven = drive.rec ? ApexUnits.long(drive.rec.km * 1000, 1) : null;
      const onRoute = track && track.kind === 'route';
      const offWords = onRoute && state.cursorIdx < 0 && state.mode === 'live' ? offRouteText() : null;
      if (offWords) return { short: islandWords(offWords), note: [offWords, driven && `${driven} driven`].filter(Boolean).join(' · ') };
      if (onRoute) {
        const next = allEvents().filter(e => e.type === 'corner' && noteM(e) > state.cursorM).reduce((m, e) => Math.min(m, noteM(e)), Infinity);
        const d = Number.isFinite(next) ? distLabel(next - state.cursorM) : null;
        // U-131: the island's compact trailing slot gets the next corner's distance ("1.0 MI"); QUIET is for the expanded view
        return { short: 'QUIET', trail: d ? `${d.n} ${d.u}`.toUpperCase() : '', note: d ? `Quiet · next corner ${d.n} ${d.u.toLowerCase()}` : ['Quiet', driven && `${driven} driven`].filter(Boolean).join(' · ') };
      }
      return { short: 'REC', note: driven ? `Recording · ${driven}` : 'Recording' };
    }
    // U-103: the island's compact word is one the driver reads elsewhere, never one made up for it ("RSQ", and "OFF", which
    // also read as recording off). A corner: its code as the car map's plates print it ("R2", "LHP"; a square or acute
    // corner by its number, as a road book rates it); a junction or hazard: its own word ("Sharp right", "Crest"), the
    // first part of it ("Roundabout" of "Roundabout · exit 2"); off the route: the status line's own words ("Wrong way").
    function islandWords(text) {
      const t = String(text || '').split(' · ')[0].replace(/…$/, '').trim();
      return t.length <= 12 ? t : t.split(' ')[0];
    }
    // M-3 (panel round 1): a corner in the driver's notation, as the strip's next cells and the car's plates print it
    // ("TIGHT R" with plain words, "L4-", "LHP", "SQ L" with rally words; plain_notes.js noteCode)
    function islandShort(n, words) {
      if (!n) return '';
      const own = n.type === 'corner' && typeof ApexPlainNotes !== 'undefined' ? ApexPlainNotes.noteCode(n, words) : null;
      if (own) return own;
      if (n.type === 'corner' && (n.dir === 'L' || n.dir === 'R')) {
        const hp = n.severity === 'HP' || n.shape === 'hairpin', sev = Math.round(+n.severity);
        if (hp) return `${n.dir}HP`;
        if (sev >= 1 && sev <= 6) return `${n.dir}${sev}`;
      }
      return islandWords(n.code || n.call);
    }
    function pushActivity(notes) {
      if (!liveAct.on) return;
      const n = notes && notes[0], q = n ? null : quietActivity();
      const fields = { note: n ? (n.type === 'turn' ? `${n.code}${n.call ? ' · ' + n.call : ''}` : n.call) : q.note, distance: n ? `${n.dist} ${n.unit}`.trim() : '', eta: etaText || '',
        // the island's compact view: a few characters, never a sentence; a hazard turns its keyline orange (LiveActivity/ApexLiveWidget.swift).
        // U-61: a short word of its own when nothing is ahead (the widget once cut "No notes ahead" to "NO NOT"); codes are
        // already short, the widget scales rather than cut one
        short: n ? islandShort(n, state.noteWords) : q.short, trail: n ? '' : (q.trail || ''), hazard: !!(n && n.type !== 'corner' && n.type !== 'turn'), etaShort: (etaText || '').split('·')[0].trim() };
      const key = JSON.stringify(fields), now = performance.now();
      // unchanged notes are resent once a minute: the shell marks each update stale two minutes on (a stop at a light stays live)
      if ((key === liveAct.last && now - liveAct.at < 60000) || (now - liveAct.at < 3000 && liveAct.last && JSON.parse(liveAct.last).note === fields.note)) return;
      liveAct.last = key; liveAct.at = now;
      activity('update', fields);
    }
    // ---- live delta on your saved stages (IDEAS D-05; web/stage_delta.js) ----------------------------------------------
    // Stages are the ones marked in the Log (apex.segments); the reference is your best-scoring pass among the drives here.
    let stageWatch = null;
    async function startStageWatch() {
      stageWatch = null;
      let segs = [];
      try { segs = JSON.parse(localStorage.getItem('apex.segments') || '[]'); } catch (_) {}
      if (!Array.isArray(segs) || !segs.length || !window.ApexStageDelta) return;
      // the reference passes come from the analysis worker (REVIEW_FEEL F-04): no drive's rows are read here at Start
      let refs = [];
      try { refs = (await ApexAnalysis.job('stageRefs', { segs })).refs || []; } catch (_) { refs = []; }
      if (refs.length && driveActive) stageWatch = { tracker: ApexStageDelta.createTracker(Core, refs), at: 0 };
    }
    function feedStage() {
      const w = stageWatch, rows = drive.rec && drive.rec.rows;
      if (!w || !rows || performance.now() - w.at < 1000) return;
      w.at = performance.now();
      const r = w.tracker.update(rows);
      const bar = $('stageBar');
      if (!r) { bar.hidden = true; return; }
      bar.hidden = r.state === 'done';
      $('stageName').textContent = r.name;
      $('stageDelta').textContent = ApexStageDelta.label(r.delta);
      $('stageCount').textContent = `${r.done}/${r.of} corners`;
      bar.classList.toggle('ahead', r.delta > 0); bar.classList.toggle('behind', r.delta < 0);
      if (r.state !== 'done') return;
      const line = r.delta == null ? `${r.name} done.` : r.delta === 0 ? `${r.name}: level with your best.` : `${r.name}: ${Math.abs(r.delta)} points ${r.delta > 0 ? 'up on' : 'down on'} your best.`;
      toast(line);
      if (r.delta != null) sayQuietLine(line);   // the co-driver says how the stage went, once it's over (technique, never time)
    }
    // ---- live coaching against your best pass, on any road driven before (web/pass_coach.js) ---------------------------
    // Each remembered corner you finish is set against its fastest pass (the time gap, owner 2026-11-14) and its best
    // technique (where no clock is known). The bar shows the stretch's gap on the phone only (never on CarPlay) and gives way to a saved stage's bar. The co-driver speaks only
    // with full notes on, in the quiet slot sayQuietLine waits for, and a corner line at most every 20 s; how a stretch went
    // is always said.
    let coachWatch = null;
    function startCoach() {
      coachWatch = window.ApexPassCoach && passRefs.length ? { coach: ApexPassCoach.createCoach(Core, passRefs), at: 0, saidAt: -Infinity } : null;
      $('coachBar').hidden = true;
    }
    function feedCoach() {
      const w = coachWatch, rows = drive.rec && drive.rec.rows;
      if (!w || !rows || performance.now() - w.at < 1000) return;
      w.at = performance.now();
      if (w.coach.setSurface) w.coach.setSurface(drive.wet && drive.wet.state);   // a wet road: your dry best is no time to chase
      const r = w.coach.update(rows), bar = $('coachBar');
      for (const ev of r.events) {
        if (!ev.say || !isSpirited()) continue;
        if (ev.kind === 'corner' && performance.now() - w.saidAt < 20000) continue;
        w.saidAt = performance.now(); sayQuietLine(ev.say);
      }
      const v = r.view;
      bar.hidden = !v || (v.delta == null && v.gap == null) || !$('stageBar').hidden;
      if (bar.hidden) return;
      $('coachDelta').textContent = ApexPassCoach.label(v.delta, v.gap);
      $('coachCount').textContent = `${v.n} corner${v.n === 1 ? '' : 's'}`;
      const up = Number.isFinite(v.gap) ? v.gap < -0.05 : v.delta > 0, down = Number.isFinite(v.gap) ? v.gap > 0.05 : v.delta < 0;
      bar.classList.toggle('ahead', up); bar.classList.toggle('behind', down);
    }
    // Track day mode (track_mode.js, IDEAS D-15): only on a mapped raceway. Every 30 s while moving the map is asked whether
    // you're on one; then "Start/finish here" sets the line where you are, and the bar shows laps, sectors and the delta.
    const circuit = { checkedAt: 0, on: false, busy: false, timer: null, prev: null };
    function resetCircuit() { Object.assign(circuit, { checkedAt: 0, on: false, busy: false, timer: null, prev: null }); $('lapBar').hidden = true; $('lapSetBtn').hidden = true; }
    function feedTrack(fr) {
      if (!window.ApexTrackMode || !fr || !Number.isFinite(fr.lat) || (window.ApexFlags && !ApexFlags.on('track_mode'))) return;
      const now = Number.isFinite(fr.t) ? fr.t : Date.now();          // a frame's own time when it has one
      if (!circuit.on && !circuit.busy && now - circuit.checkedAt > 30000 && fr.speed_mps > 3 && window.ApexStages && ApexStages.transportationAt) {
        circuit.busy = true; circuit.checkedAt = now;
        ApexStages.transportationAt(fr.lat, fr.lon).then((f) => {
          circuit.busy = false;
          if (!driveActive || !ApexTrackMode.onRaceway(f, fr.lat, fr.lon)) return;
          circuit.on = true; $('lapBar').hidden = false; $('lapSetBtn').hidden = false;
          $('lapName').textContent = 'On a circuit'; $('lapTime').textContent = '--'; $('lapInfo').textContent = 'Tap at the start/finish line';
          say('Track mode. Tap start finish when you cross the line.', true);
        }).catch(() => { circuit.busy = false; });
      }
      if (circuit.timer) {
        const r = circuit.timer.feed({ lat: fr.lat, lon: fr.lon, t: now }), st = circuit.timer.state(now);
        if (r) { const L = r.lap, mm = Math.floor(L.timeS / 60), ss = Math.floor(L.timeS % 60), hh = Math.floor((L.timeS * 100) % 100), N = ApexVoiceLines.num;
          const tk = [N(L.n), N(mm), N(ss), N(hh)].every(Boolean) ? ['line:lap', N(L.n), N(mm), N(ss), N(hh), ...(st.best === L ? ['line:best'] : [])] : undefined;
          say(`Lap ${L.n}. ${ApexTrackMode.lapText(L.timeS).replace(':', ' ')}${st.best === L ? '. Best' : ''}`, true, null, null, { tokens: tk }); }
        $('lapName').textContent = `Lap ${st.laps.length + (st.running ? 1 : 0)}`;
        $('lapTime').textContent = st.delta == null ? ApexTrackMode.lapText(st.elapsedS) : `${st.delta > 0 ? '+' : ''}${st.delta.toFixed(2)}`;
        $('lapInfo').textContent = [st.last ? `last ${ApexTrackMode.lapText(st.last.timeS)}` : '', st.best ? `best ${ApexTrackMode.lapText(st.best.timeS)}` : ''].filter(Boolean).join(' · ');
        $('lapBar').classList.toggle('ahead', st.delta != null && st.delta < 0); $('lapBar').classList.toggle('behind', st.delta != null && st.delta > 0);
      }
      circuit.prev = fr;
    }
    $('lapSetBtn').addEventListener('click', () => {
      const fr = state.live;
      if (!circuit.on || !fr) return;
      const h = Number.isFinite(fr.course_deg) ? fr.course_deg : circuit.prev && circuit.prev !== fr ? Math.atan2((fr.lon - circuit.prev.lon) * Math.cos(fr.lat * Math.PI / 180), fr.lat - circuit.prev.lat) * 180 / Math.PI : null;
      if (h == null) { toast('Move a little first so the line knows which way you go.'); return; }
      circuit.timer = ApexTrackMode.createLapTimer({ lat: fr.lat, lon: fr.lon, headingDeg: h });
      $('lapSetBtn').hidden = true; $('lapInfo').textContent = 'Line set · laps start at the next crossing';
      toast('Start/finish set here. Laps are timed from the next crossing.');
    });
    // Your taste from what you drive (taste.js recordPick, IDEAS R-33): starting a route you chose over the one Vetta put
    // first (another card, a swipe) is half an answer to "which was better?": the chosen road beat the passed one. Only
    // between routes within 30 % of each other's time (a much longer pick says more about your afternoon than your
    // taste), once per plan, never for loops (their cards are directions, not kinds of road). Kept on this phone.
    let pickLearned = null;
    function learnFromPick() {
      try {
        const o = routeOptions, t = plannedRoute;
        window.apexDebug.pickWhy = { levels: o && o.levels, picked: o && o.picked, times: o && o.list && o.list.map((r) => r && Math.round(r.timeS)) };
        if (!window.ApexTaste || !o || !o.list || o.current !== t || !t || t.id !== 'route_dest' || pickLearned === o) return;
        // Vetta's pick is the plan's own level's (the list starts with Quick's, so list[0] is not it); after a refine's swap
        // it is the swapped-in one, since the refine ranks at that same level
        const first = o.levels && o.builtLevel ? o.levels[o.builtLevel] : null;
        if (first == null || o.picked === first) return;
        const chosen = o.list[o.picked], passed = o.list[first];
        if (!chosen || !passed || !chosen.t || !passed.t || !(chosen.timeS > 0) || !(passed.timeS > 0)) return;
        if (Math.abs(chosen.timeS - passed.timeS) > 0.3 * Math.min(chosen.timeS, passed.timeS)) return;
        const fc = ApexTaste.featuresOf(Core, chosen.t, { quick: true }), fp = ApexTaste.featuresOf(Core, passed.t, { quick: true });
        const before = ApexTaste.load(localStorage), after = ApexTaste.recordPick(before, fc, fp);
        if (after === before) return;
        pickLearned = o;
        ApexTaste.save(localStorage, after);
        const lean = ApexTaste.leanOf(fc, fp);
        if (window.apexDebug) window.apexDebug.lastPick = { lean, picks: after.picks, fc, fp };
        if (lean) setTimeout(() => toast(`Noted: you picked the more ${lean} road. Your fun routes learn from it.`), 1500);
      } catch (_) { /* a taste is a nicety: never in the way of a drive */ }
    }
    async function enterDrive() {
      if (state.mode === 'live' && drive.sensors) return;
      if (state.mode === 'live' || driveActive) return;                                   // native app is feeding frames already or start is pending
      driveActive = true; health.bump('drives'); drive.startedAt = performance.now(); pushQuiet(true);
      driveCam(true);                                                  // Film the drive (DriveCam.swift): the app films the road
      leaveAtMs = null; whenReset();                                                     // driving it now: the plan's hour is this one
      learnFromPick();                                                 // a route you chose over Vetta's first: your taste (taste.js)
      // A drive takes the whole screen, whatever the phone was showing: a drive started from the car (or a link, or Siri)
      // with the Crew or Garage sheet or the Log open left that page in the middle of the drive screen (the owner, 2026-10-30).
      if (logFrame.el && !logFrame.el.hidden) { logFrame.el.hidden = true; document.documentElement.classList.remove('log-open'); }
      showView(null);
      openPlan(false);                                                 // the plan sheet too, and the keyboard with it
      if (track && track.kind === 'route') persistActive(track);       // kept if the app is closed mid-drive
      askAhead(track);                                                 // a planned route: the reports along it, ahead of a dead zone
      keepNetworkAlong(track);                                         // and our road network along it, for a reroute there
      clearCarOffer();
      // U-59: the car enters every drive, a route or none (it went into a drive only on a guide message, so a free drive never
      // reached it: no End, no card). A route driven again goes back on the car's map first.
      car.ended = null; car.guideKey = '';
      if (track && track.kind === 'route') carRoute(track);
      carPost({ kind: 'start', title: track && track.kind === 'route' ? String(track.name || 'Route').slice(0, 80) : 'Drive' });
      setPlaying(false);
      drive.rec = new ApexSensors.Recorder(); drive.status = { gps: 'waiting', motion: 'off', wake: 'off', message: '' }; drive.frames = 0; drive.battery = null;
      startStageWatch(); startCoach();
      state.firstNoteDue = true; state.firstNoteKey = null;   // U-58: the drive's first note is called
      state.openerDue = true; state.openerAt = performance.now(); state.wakeCue = false;   // DA-3: the first words name the road
      drive.live = null; drive.liveIdx = 0; drive.share = 'off'; drive.shareKm = 0; drive.shareErr = null; drive.roads = {}; drive.roadIdx = 0; drive.rest = null; drive.brakes = null; drive.descentSaid = null; drive.flow = null; brakeSay = null; breakSay = null; flowSay = null; flowQueue = []; sunSay = null; drive.sunAt = null; limitSay = null; drive.limitSaid = null; briefSay = null; drive.briefed = false; cornersSay = null; drive.sectionsSaid = null; alongSay = null; drive.alongSaid = null; drive.viewAt = null; free.marksSaid = null; drive.wet = null; if (window.ApexNoteTiming && ApexNoteTiming.setRoad) ApexNoteTiming.setRoad(null); drive.surface = window.ApexRoadSurface ? ApexRoadSurface.createLog() : null; if (breakWorker) { breakWorker.terminate(); breakWorker = null; }
      keepStart();                                                     // Round 3: the drive is kept as it goes (drive_keep.js)
      if (NATIVE_SHELL) {   // the app's own GPS and IMU feed window.apex.live; no browser sensors to start
        drive.native = true;
        { const a = ambientStats(); drive.ambientTrips = a ? a.trips - (a.active ? 1 : 0) : 0; }
        activity('start', { title: track ? track.name : 'Drive', note: 'Recording', distance: '', eta: '' });
        drive.status = { gps: performance.now() - state.liveAt < 5000 && state.live ? 'on' : 'waiting', motion: 'on', wake: 'on', message: '' };
        setPlaying(false); setMode('live'); paintModeSwitch(); resumeFollow(); paintDriveStat();
        if (state.live) render(true);
        return;                                                              // road data: the app-open sharer (ambient) covers drives too
      }
      setMode('live'); paintModeSwitch(); paintDriveStat(); resumeFollow();
      try {
        const sensors = await ApexSensors.start({
          onStatus: (s) => {
            drive.status = s;
            if (s.motion === 'denied' || s.motion === 'unavailable') motDenied = true;
            else if (s.motion === 'on') motDenied = false;
            if (s.gps === 'denied') {
              locDenied = true; paintPerms();
              leaveDrive(false);
              $('permSheet').classList.add('show');
              return;
            }
            if (s.gps === 'on' || s.gps === 'weak') locDenied = false;
            paintPerms();
            paintDriveStat();
          },
          onFrame: (fr) => { if (!fr.has_fix) return; drive.frames++; drive.status.webMount = fr.web_mount || null; recordFrame(fr); feedLive(); noteRoads(); noteRest(fr); noteBrakes(fr); noteWet(); noteFlow(); feedStage(); feedCoach(); feedTrack(fr);
            if (window.ApexBattery && webBattery) drive.battery = ApexBattery.feed(drive.battery, webBattery.level, webBattery.charging, Date.now());
            window.apex.live(fr); paintDriveStat(); },
        });
        if (!driveActive || state.mode !== 'live') {
          sensors.stop();
          return;
        }
        drive.sensors = sensors;
        startLiveSharing();
      } catch (e) {
        if (driveActive && state.mode === 'live') {
          toast(e.message || 'Couldn\'t start GPS.');
          leaveDrive(false);
        }
      }
    }
    // The drive-ended card (REVIEW.md roadmap 7): the moment after the Skyway gets the screen, not a toast. The drive is
    // already saved; the card shows its name, distance and time, the Vetta Score big (-- without clean corners) and one
    // thing to work on (U-111: the Log's own coaching sentence), with Share card and Mark a stage.
    let endDrive = null;
    // F-04 (REVIEW_FEEL): the card comes first, in the frame after End, with what the recording already knows (its name,
    // distance, time and trail); the score, the tip and the closing line follow when the worker has parsed, scored and saved
    // the drive (endCardScored). c: { id, name, len_m, secs, corners (a count, or null while scoring), ds (null while
    // scoring), ended, lat, lon }. A full record (showEndCard) goes through the same two steps at once.
    // The reveal (end_reveal.js): the driven line is drawn beside the score's place while the drive is scored, and the
    // number counts up only once it is known. The facts are a ledger of the same words (#endMeta's text is still the line).
    const endEl = () => ({ card: $('endCard').querySelector('.end-card'), glyph: $('endGlyph'), meta: $('endMeta'), score: $('endScore') });
    function endCardOpen(c) {
      endDrive = c;
      endClipReset();
      $('endName').textContent = c.name || 'Your drive';
      $('endMeta').textContent = ApexFormat.factsLine(c);              // RA-3: the Log's numbers, from the one helper
      if (window.ApexEndReveal) ApexEndReveal.open(endEl(), { facts: ApexFormat.factsLine(c), runs: Array.isArray(c.lat) && Array.isArray(c.lon) ? endTrailRuns(c.lat, c.lon) : [] });
      const ended = window.ApexDriveKeep ? ApexDriveKeep.endNote(c) : null;   // Round 3: a drive that ended itself says how
      // a wet or icy drive says so (road_surface.js label): its score and gaps are set against your wet passes, not your dry
      const wetW = window.ApexRoadSurface ? ApexRoadSurface.label(c.surface) : '';
      $('endLine').textContent = [ended, wetW].filter(Boolean).map((x) => x + '.').join(' ');
      // panel round 2 (HE-1): one measured road-feel line from this drive's own rows (road_feel.js); none for a drive whose
      // mount never calibrated, so nothing unmeasured is ever said
      const feel = window.ApexRoadFeel && c.feel ? ApexRoadFeel.endLine(c.feel, (m) => ApexUnits.long(m, 1)) : '';
      $('endFeel').textContent = feel; $('endFeel').hidden = !feel;
      $('endPractice').textContent = ''; $('endPractice').hidden = true;   // IDEAS D-27: with the score (endCardScored)
      $('endRoad').textContent = ''; $('endRoad').hidden = true;           // the road's line, with the score too
      $('endRun').textContent = ''; $('endRun').hidden = true;             // IDEAS D-30: a month's best run, with the score too
      // scoring: no number yet, never "--" (that means "no score"), and no key that needs the score
      $('endScore').textContent = '…'; $('endScore').classList.add('unk'); $('endScore').setAttribute('aria-busy', 'true');
      $('endScore').parentElement.classList.remove('no-score');
      $('endUsual').textContent = ''; $('endUsual').hidden = true;
      $('endLog').href = $('endLogKey').href = `analysis.html?tab=drive&drive=${encodeURIComponent(c.id)}`;
      // U-118: the keys are the scored layout from the first frame (Share card solid, Open in the Log the link), so nothing
      // swaps under a reaching finger when the score lands; Share waits for it. Only a drive with no score changes them.
      $('endShare').hidden = false; $('endShare').setAttribute('aria-disabled', 'true'); $('endShareLink').hidden = true; $('endLogKey').hidden = true; $('endLog').hidden = false;
      $('endAgain').hidden = true;                                     // panel D-1: once the drive is stored (endCardScored)
      // Post (drive_posts.js), for a member: there from the first frame like Share card (U-118), waiting for the score
      const member = !!drivePosts && !!(accountMe && accountMe.member);
      $('endPostRow').hidden = !member; $('endPost').disabled = false; $('endPost').textContent = 'Post to friends'; $('endPost').setAttribute('aria-disabled', 'true');
      $('endPostMore').hidden = false; $('endPostMore').setAttribute('aria-disabled', 'true');
      $('endShare').classList.toggle('solid', !member);
      $('endCard').classList.add('show');
      showEndTrail(c);
    }
    // IDEAS D-27: the plan Your driving keeps (driver_profile.js savePlan), or null
    function practicePlan() {
      try { const x = JSON.parse(localStorage.getItem('vetta.practice') || 'null'); return x && typeof x.skill === 'string' ? x : null; } catch (_) { return null; }
    }
    // what a drive with no score was, in the score's slot: no corners at all, or too few clean ones to score
    const noScoreWords = (corners) => (Number.isFinite(corners) && corners > 0 ? 'Too few clean corners to score' : 'No corners to score');
    // The score arrived (ds: { score, components }, corners: a count; others: your earlier drives with this name, scored)
    // TestFlight 2026-11-12 (the owner: "cluttered", "walls of text"): at most two lines under the score, the ones you
    // asked for or earned first (the practice, a month's best run), then the road's and what the phone felt
    function endLinesCap() {
      let shown = 0;
      for (const id of ['endPractice', 'endRun', 'endRoad', 'endFeel']) {
        const n = $(id);
        if (!n.textContent) { n.hidden = true; continue; }
        n.hidden = shown >= 2; if (!n.hidden) shown++;
      }
    }
    // The App Store rating (StoreKit requestReview in the shell; docs/APP_REVIEW.md 5.6.1): after a good drive, parked, from
    // the third drive on, once per app version (end_line.js askReview). A few seconds after the score lands, if the card is
    // still up, so it never covers the number as it counts.
    async function endReviewAsk(c, best) {
      const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apex;
      const version = (/ApexNav\/([^\s(]+)/.exec(navigator.userAgent) || [])[1] || null;
      let askedFor = null; try { askedFor = localStorage.getItem('vetta.reviewAsked'); } catch (_) {}
      let drives = null; try { drives = (await ApexRecording.summaries(null)).length; } catch (_) { drives = null; }
      // the phone's speed now: the shell's last fix (live or idle), and only a fresh one (10 s) counts as known
      const speedNow = () => (state.lastMotion && Number.isFinite(state.lastMotion.speedMps) && performance.now() - (state.lastPositionAt || -1e9) < 10000 ? state.lastMotion.speedMps : null);
      const v = speedNow();
      if (!window.ApexEndLine || !ApexEndLine.askReview || !ApexEndLine.askReview({ app: !!native, score: c.ds.score, best, drives, speedMps: v, version, askedFor })) return;
      setTimeout(() => {
        const v2 = speedNow(), still = v2 != null && v2 < 1.5;   // still parked, 3 s on
        if (!still || !endDrive || endDrive.id !== c.id || !$('endCard').classList.contains('show')) return;
        try { localStorage.setItem('vetta.reviewAsked', version); native.postMessage({ cmd: 'askReview' }); } catch (_) {}
      }, 3000);
    }
    function endCardScored(c, others, opts = {}) {
      if (!endDrive || endDrive.id !== c.id) return;                   // another card since
      endDrive = { ...endDrive, ...c };
      if (roadbooks) roadbooks.afterDrive(c.id).catch(() => {});      // a road of one of your roadbooks this drive covered is stamped
      if (!window.ApexEndReveal) $('endMeta').textContent = ApexFormat.factsLine(c);   // else the ledger takes the new fact in (land, below)
      $('endScore').removeAttribute('aria-busy');
      // D-6 / R-5 (panel round 1): a drive with no score still reads as a drive. The score's slot says why, "No corners to
      // score", instead of "-- /1000" over a sentence about a failed exam; nothing is invented (no number). The distance is
      // the facts row's right under it, so it is not said twice (2026-11-13 sweep: "3.7 mi · no corners…" over "3.7 mi").
      const none = c.ds.score == null;
      $('endScore').textContent = none ? noScoreWords(c.corners) : String(c.ds.score);
      $('endScore').classList.remove('unk');                         // the words are the answer; "--" never shows as a score here
      $('endScore').parentElement.classList.toggle('no-score', none);
      if (window.ApexEndReveal) ApexEndReveal.land(endEl(), { score: none ? null : c.ds.score, facts: ApexFormat.factsLine(c) });
      // the number against your usual (design pass 9): "31 over your usual", from your last few scored drives in the Log.
      // Read after the card is painted (the Log's summaries, on the phone), and only said with three or more to go by.
      if (!none && window.ApexEndLine && ApexEndLine.usual) (async () => {
        try {
          const all = await ApexRecording.summaries(null), me = all.find((o) => o.id === c.id);
          const before = all.filter((o) => o.id !== c.id && (!me || String(o.date || '') <= String(me.date || ''))).map((o) => (o.ds && o.ds.score != null ? Math.round(o.ds.score) : null));
          if (!endDrive || endDrive.id !== c.id) return;
          // IDEAS D-30: a run of clean corners that beats every other drive's this month (its summary's run, flow.js)
          const runLine = me && ApexEndLine.bestRunMonth && window.ApexAnalysis ? ApexEndLine.bestRunMonth(me, all, ApexAnalysis.monthOf) : null;
          if (runLine) {
            $('endRun').textContent = runLine; $('endRun').hidden = false; endLinesCap();
            const sheet = $('endCard').querySelector('.card-sheet');      // a taller card: the drive is fitted again above it
            if (endTrailOn && sheet && Math.abs(sheet.getBoundingClientRect().top - endTrailTop) > 4) showEndTrail(endDrive);
          }
          const u = ApexEndLine.usual(c.ds.score, before);
          if (!u) return;
          $('endUsual').textContent = u.text; $('endUsual').hidden = false;
        } catch (_) { /* no Log to read: nothing said */ }
      })();
      // U-111: one coaching sentence, the Log's (analysis_client.js coachLineOf, written in the job that scored the drive)
      const tip = none ? '' : typeof c.coach === 'string' ? c.coach : '';
      const ended = window.ApexDriveKeep ? ApexDriveKeep.endNote(c) : null;
      const S = window.ApexRoadSurface, wetW = S ? S.label(c.surface) : '';   // "Wet road.": set against your wet passes only
      const tipLine = [ended ? ended + '.' : '', tip].filter(Boolean).join(' ');
      // your best on this road (REVIEW.md 4.4): against your earlier drives named after the same road; then the pack's closing line
      let best = false;
      if (c.ds.score != null && window.ApexEndLine) { try { best = ApexEndLine.bestOnRoad({ id: c.id, name: c.name, score: c.ds.score }, (others || []).filter((o) => !S || !o || S.alike(c.surface, o.surface))); } catch (_) { best = false; } }
      const bestW = !best ? '' : wetW ? `Your best ${c.surface === 'ice' ? 'icy' : 'wet'} drive on this road.` : 'Your best on this road.';
      $('endLine').textContent = [best ? bestW : wetW ? wetW + '.' : '', tipLine].filter(Boolean).join(' ');
      endReviewAsk(c, best);                                           // a good drive, parked: the App Store rating, once a version
      // IDEAS D-27: the skill Your driving is practicing, read on this drive alone (analysis_client.js practiceOf)
      const prLine = c.practice && typeof c.practice.line === 'string' ? c.practice.line : '';
      $('endPractice').textContent = prLine; $('endPractice').hidden = !prLine;
      // a road you have driven before: where this drive lost most at its least even corners, or your cleanest passes on it
      const roadLine = typeof c.road === 'string' ? c.road : '';
      $('endRoad').textContent = roadLine; $('endRoad').hidden = !roadLine;
      endLinesCap();
      if (window.ApexEndLine && !opts.quiet) {                       // Round 3: never aloud to a parked car or a pocket
        const pack = ['marguerite', 'kit', 'hale'].includes(state.voiceId) ? state.voiceId : 'marguerite';
        // one of the pack's sign-offs, the same for this drive every time, from a clip the loaded bank holds (U-113)
        const bank = window.ApexVoice && ApexVoice.bank, has = (k) => !!(bank && bank.id === pack && bank.tokens[k]);
        const line = ApexEndLine.endLine(pack, c.ds.score == null ? null : Math.round(c.ds.score), best, ApexEndLine.pickSignOff(pack, c.id, has));
        say(line.text, false, null, null, state.voiceId === 'device' ? {} : { tokens: line.tokens });
      }
      // U-75: Share card is the solid key only with a score to share; with none, Open in the Log is, and Share is a link
      const scored = c.ds.score != null;
      $('endShare').removeAttribute('aria-disabled');
      // Post (drive_posts.js) is the solid key for a member with a score: the drive goes to friends first; Share card, the
      // picture for other apps, stays beside it
      const posting = scored && !!drivePosts && !!(accountMe && accountMe.member);
      $('endPostRow').hidden = !posting; $('endPost').removeAttribute('aria-disabled'); $('endPostMore').removeAttribute('aria-disabled');
      $('endShare').classList.toggle('solid', !posting);
      $('endShare').hidden = !scored; $('endShareLink').hidden = scored;
      $('endLogKey').hidden = scored; $('endLog').hidden = !scored;
      $('endAgain').hidden = !(Number.isFinite(endDrive.len_m) && endDrive.len_m >= ApexYourRoads.MIN_LEN_M);   // panel D-1: a road, not an errand
      paintEndClip(c.id);                                              // big bet 5: the best corner, when filmed
      // the card's words changed its height: the drive is fitted again to the map the card now leaves
      const sheet = $('endCard').querySelector('.card-sheet');
      if (endTrailOn && sheet && Math.abs(sheet.getBoundingClientRect().top - endTrailTop) > 4) showEndTrail(endDrive);
    }
    // A whole record (the review recording, a debug call): U-91, scored exactly as the Log scores it, and the drive's time
    // the recording's own, as the Log counts it, not the wall clock since Start.
    function showEndCard(d, startedAt, opts = {}) {
      const scored0 = ApexRecording.scoreOf(Core, d);
      d.corners = scored0.corners; d.ds = scored0.ds;
      let secs = null;
      try { const T = Core.elapsedS(d.speed_mps), s = T[T.length - 1]; secs = Number.isFinite(s) ? s : null; } catch (_) { secs = null; }
      const c = { id: d.id, name: d.name, ended: d.ended, len_m: Array.isArray(d.dist) && d.dist.length ? d.dist[d.dist.length - 1] : null, secs,
                  lat: d.lat, lon: d.lon, elev: d.elev, dist: d.dist, corners: null, ds: null, record: d, surface: d.surface,
                  feel: window.ApexRoadFeel ? ApexRoadFeel.summary({ dist: d.dist, camber: d.camber, rough: d.rough }) : null };
      endCardOpen(c);
      (async () => {
        let others = [];
        if (d.ds.score != null) try {
          others = (await ApexRecording.summaries()).filter((o) => o.id !== d.id && o.name === d.name).map((o) => ({ id: o.id, name: o.name, surface: o.surface || null, score: o.ds && o.ds.score != null ? Math.round(o.ds.score) : null }));
        } catch (_) { others = []; }
        let practice = null;                                           // IDEAS D-27: the practised skill, when the drive is stored
        const plan = practicePlan();
        if (plan && window.ApexAnalysis) try { practice = (await ApexAnalysis.job('practiceLine', { id: d.id, plan })).practice || null; } catch (_) { practice = null; }
        let coach = null, road = null;                                 // U-111: the Log's sentence, when the drive is stored; with it the road's line, which skips the practised skill
        if (d.ds.score != null && window.ApexAnalysis) try { const r = await ApexAnalysis.job('coachLine', { id: d.id, skip: practice && plan ? plan.skill : null }); coach = r.coach || null; road = r.road || null; } catch (_) { coach = null; road = null; }
        let stages = [];                                               // your saved stages it went over, for its post
        const segs = savedStages();
        if (segs.length && window.ApexAnalysis) try { stages = (await ApexAnalysis.job('stagesOf', { id: d.id, segs })).stages || []; } catch (_) { stages = []; }
        endCardScored({ ...c, corners: d.corners.length, ds: d.ds, coach, practice, road, stages }, others, opts);
      })();
    }
    // U-88: behind the card, the map is the drive: fitted to its trail above the card, the trail drawn at the route's width in
    // the accent. It goes when the card does, however it closes, and the map follows again.
    // U-88 (check): a fix more than END_JUMP_M from the one before starts a new run, and a run of a few fixes is a stray (the
    // first fix before the start offset, a cell-tower jump), so it neither draws a line across the county nor widens the fit
    const END_JUMP_M = 1000, END_STRAY_N = 5;
    function endTrailRuns(lat, lon) {
      const runs = [];
      let run = null, prev = null;
      for (let i = 0; i < lat.length; i++) {
        const la = lat[i], lo = lon[i];
        if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
        const jump = prev && Math.hypot((la - prev[1]) * 110540, (lo - prev[0]) * 111320 * Math.cos(la * Math.PI / 180)) > END_JUMP_M;
        if (!run || jump) { run = []; runs.push(run); }
        run.push([lo, la]); prev = [lo, la];
      }
      const kept = runs.filter((r) => r.length >= END_STRAY_N);
      return kept.length ? kept : runs.filter((r) => r.length >= 2).sort((a, b) => b.length - a.length).slice(0, 1);
    }
    // KE-1 (panel round 2): the card's map was blank in both recordings (r7 guided-drive/phone/286, tabs/phone/015) though
    // the code drew the trail. The trail is a map layer, and the map draws it only once it has fetched and parsed the tiles
    // of the place it flies to; a 900 ms flight across zooms asked for every zoom on the way while the analysis worker was
    // scoring the drive, so on a phone the card's first seconds were an empty map. Now the fit is a jump (the final view's
    // tiles only), and the road's portrait (road_portrait.js) is drawn over the map at once, exactly where the fit puts the
    // trail; it steps back when the map has drawn it (its 'idle'). With no map at all (offline, no WebGL) it stays.
    let endPortraitRun = 0;
    function paintEndPortrait(runs, d, box, mr, band) {
      const el = $('endPortrait'), run = ++endPortraitRun;
      if (!el || !window.ApexRoadPortrait) return run;
      el.classList.remove('drawn');
      Object.assign(el.style, { left: `${mr.left}px`, top: `${mr.top}px`, width: `${box.w}px`, height: `${box.h}px` });
      const road = ApexRoadPortrait.svg(runs, box, { line: look.colors.accent, casing: look.colors.routeCasing }) || '';
      const climb = band ? ApexRoadPortrait.profile(d.elev, d.dist, box.w - box.left - box.right, band, { ink: look.colors.ink }) : null;
      el.innerHTML = road + (climb ? `<div class="rp-band" style="left:${box.left}px;right:${box.right}px;bottom:${box.bottom - band - 8}px;height:${band}px">${climb}</div>` : '');
      el.hidden = !road;
      return run;
    }
    function showEndTrail(d) {
      if (!Array.isArray(d.lat) || !Array.isArray(d.lon) || d.lat.length < 2) return;
      const runs = endTrailRuns(d.lat, d.lon);
      if (!runs.length) return;
      // the part of the map the card leaves: from under the island to the card's top edge (on its side the card is beside it)
      const sheet = $('endCard').querySelector('.card-sheet'), mr = map.getContainer().getBoundingClientRect();
      endTrailTop = sheet ? sheet.getBoundingClientRect().top : 0;
      const wide = matchMedia('(orientation: landscape) and (max-height: 540px)').matches;
      const top = Math.max(32, (parseFloat(safeInsets().top) || 0) - mr.top + 24);
      let bottom = wide || !sheet ? 24 : Math.max(24, Math.min(mr.height - top - 100, mr.bottom - sheet.getBoundingClientRect().top + 24));
      // the climbs, a band 36 px tall under the road, when the recording measured its height and there is room for both
      const band = !wide && Array.isArray(d.elev) && mr.height - top - bottom > 220 && d.elev.some(Number.isFinite) ? 36 : 0;
      if (band) bottom += band + 8;
      const sv = viewInsets(), box = { w: mr.width, h: mr.height, top, bottom, left: sv.l + 32, right: sv.r + 32, maxZoom: 16 };
      const run = paintEndPortrait(runs, d, box, mr, band);
      endTrailOn = true;
      if (!mapReady) return;
      let w = 180, e = -180, so = 90, n = -90;
      for (const r of runs) for (const [lo, la] of r) { w = Math.min(w, lo); e = Math.max(e, lo); so = Math.min(so, la); n = Math.max(n, la); }
      const data = { type: 'FeatureCollection', features: runs.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) };
      if (map.getSource('apex-endtrail-src')) map.getSource('apex-endtrail-src').setData(data);
      else {
        map.addSource('apex-endtrail-src', { type: 'geojson', data });
        const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 16, b];
        map.addLayer({ id: 'apex-endtrail-casing', type: 'line', source: 'apex-endtrail-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': width(6, 13) } });
        map.addLayer({ id: 'apex-endtrail', type: 'line', source: 'apex-endtrail-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': width(3, 7) } });
      }
      map.setPaintProperty('apex-endtrail-casing', 'line-color', look.colors.routeCasing);
      map.setPaintProperty('apex-endtrail', 'line-color', look.colors.accent);
      map.setLayoutProperty('apex-endtrail-casing', 'visibility', 'visible'); map.setLayoutProperty('apex-endtrail', 'visibility', 'visible');
      pauseFollow();
      // U-88 (check): the follow camera leaves the map's own padding on (up to a third of its height, so the arrow sits low).
      // MapLibre adds that to the fit's padding, which left no room on a phone above the card, so the fit gave up and the
      // map stayed the follow camera's last frame. The fit owns the whole map: stop any glide and clear it first.
      map.stop();
      map.jumpTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 } });
      map.fitBounds([[w, so], [e, n]], { padding: { top, left: box.left, right: box.right, bottom }, pitch: 0, bearing: 0, duration: 0, maxZoom: 16 });
      // the map has drawn the trail (and the place under it): the portrait's line steps back; the climbs stay
      map.once('idle', () => { if (run === endPortraitRun && endTrailOn) $('endPortrait').classList.add('drawn'); });
    }
    let endTrailOn = false, endTrailTop = 0;
    function hideEndTrail() {
      if (!endTrailOn) return;
      endTrailOn = false; endPortraitRun++;
      const pe = $('endPortrait'); if (pe) { pe.hidden = true; pe.replaceChildren(); pe.classList.remove('drawn'); }
      if (!mapReady || !map.getLayer('apex-endtrail')) { resumeFollow(); return; }
      map.setLayoutProperty('apex-endtrail-casing', 'visibility', 'none'); map.setLayoutProperty('apex-endtrail', 'visibility', 'none');
      resumeFollow();
    }
    new MutationObserver(() => { if (!$('endCard').classList.contains('show')) hideEndTrail(); paintPlacePlate(); }).observe($('endCard'), { attributes: true, attributeFilter: ['class'] });
    $('endDone').addEventListener('click', () => $('endCard').classList.remove('show'));
    $('endAgain').addEventListener('click', () => { const d = endDrive; if (!d) return; $('endCard').classList.remove('show'); driveAgain(d.id, d.name); });
    $('endShareLink').addEventListener('click', () => $('endShare').click());
    // Post (drive_posts.js): the drive's card to your friends or a crew, for a member with a scored drive; once posted it says so
    // (2026-11-14) one tap: Post to friends sends it at once, with Undo in the toast; ··· beside it is the sheet (a caption,
    // or a crew instead)
    const endPostOf = () => {
      const roads = Object.entries(drive.roads || {}).filter(([, m]) => m >= 500).sort((a, b) => b[1] - a[1]).map(([n]) => n);
      const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { name: endDrive.name, driven_on: day, len_m: endDrive.len_m, score: endDrive.ds && endDrive.ds.score, lat: endDrive.lat, lon: endDrive.lon, roads, stages: endDrive.stages || [] };
    };
    // your saved stages (the Log's, apex.segments), for the stages a drive's post shows with their Scores
    function savedStages() { try { const l = JSON.parse(localStorage.getItem('apex.segments') || '[]'); return Array.isArray(l) ? l : []; } catch (_) { return []; } }
    const endPosted = (said) => { $('endPost').textContent = said; $('endPost').disabled = true; $('endPostMore').hidden = true; };
    const endPostReady = () => !!endDrive && !!drivePosts && !$('endPost').disabled && $('endPost').getAttribute('aria-disabled') !== 'true';   // not while scoring
    $('endPost').addEventListener('click', async () => {
      if (!endDrive || !drivePosts || !drivePosts.post || !endPostReady()) return;
      $('endPost').disabled = true;
      const id = await drivePosts.post(endPostOf());
      if (!id) { $('endPost').disabled = false; return; }
      endPosted('Posted to friends'); pushOffer();
      if (typeof id === 'string') toast('Posted to your friends.', { label: 'Undo', ms: 8000, onClick: async () => {
        if (await drivePosts.remove(id)) { $('endPost').textContent = 'Post to friends'; $('endPost').disabled = false; $('endPostMore').hidden = false; toast('Taken back.'); }
        else toast('Couldn’t take it back. Check signal.');
      } });
    });
    $('endPostMore').addEventListener('click', async () => {
      if (!endPostReady() || $('endPostMore').getAttribute('aria-disabled') === 'true') return;
      if (await drivePosts.compose(endPostOf())) { endPosted('Posted'); pushOffer(); }
    });
    $('endStage').addEventListener('click', () => { if (endDrive) openLog(`analysis.html?tab=segments&drive=${encodeURIComponent(endDrive.id)}`); });
    // Big bet 5: a filmed drive's best corner (best_clip.js: ranked by its own Driver Score, cut from the app's own film),
    // looping on the card once the drive is stored. One tap makes the portrait clip and opens the share sheet. No film, the
    // website, or no corner fully inside the film: no tile (nothing guessed).
    let endClipFound = null;
    function endClipReset() {
      endClipFound = null; $('endClip').hidden = true; $('endClip').removeAttribute('aria-busy');
      const v = $('endClipVideo'); v.ontimeupdate = null; try { v.pause(); } catch (_) {} v.removeAttribute('src');
    }
    async function paintEndClip(id) {
      if (!window.ApexBestClip) return;
      let f = null;
      try { f = await ApexBestClip.find(id); } catch (_) { f = null; }
      if (!f || !endDrive || endDrive.id !== id || !$('endCard').classList.contains('show')) return;
      endClipFound = f;
      $('endClipLabel').textContent = f.label || 'Your best corner'; $('endClipAct').textContent = 'Share clip';
      $('endClip').setAttribute('aria-label', `Share a clip of your best corner, ${f.label || ''}`.trim());
      const v = $('endClipVideo');
      v.src = `${f.url}#t=${f.start},${f.end}`;
      v.ontimeupdate = () => { if (v.currentTime >= f.end || v.currentTime < f.start - 0.5) v.currentTime = f.start; };   // the stretch, again
      $('endClip').hidden = false;
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) v.play().catch(() => {});
      const sheet = $('endCard').querySelector('.card-sheet');         // a taller card: the drive is fitted again above it
      if (endTrailOn && sheet && Math.abs(sheet.getBoundingClientRect().top - endTrailTop) > 4) showEndTrail(endDrive);
    }
    new MutationObserver(() => { if (!$('endCard').classList.contains('show')) { try { $('endClipVideo').pause(); } catch (_) {} } })
      .observe($('endCard'), { attributes: true, attributeFilter: ['class'] });
    $('endClip').addEventListener('click', async () => {
      const f = endClipFound, k = $('endClip');
      if (!f || k.getAttribute('aria-busy') === 'true') return;
      k.setAttribute('aria-busy', 'true'); $('endClipAct').textContent = 'Making the clip…';
      try {
        const r = await ApexBestClip.make(f);
        const ext = /mp4/.test(r.mime || '') ? 'mp4' : 'webm';
        const name = `${(endDrive && endDrive.name || 'drive').replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'drive'} best corner.${ext}`;
        let copied = false;
        const rec = window.ApexRecording ? await ApexRecording.get(f.driveId).catch(() => null) : null;
        const caption = window.ApexCornerClip && ApexCornerClip.caption ? ApexCornerClip.caption(rec || endDrive || {}, f.call) : '';
        const out = window.ApexDriveCard ? await ApexDriveCard.shareFile(r.blob, name, r.mime || `video/${ext}`, { caption, copied: () => { copied = true; } }) : 'failed';
        if (out === 'saved') toast(copied ? 'Clip saved. Its caption is copied.' : 'Clip saved.');
        else if (copied && out === 'shared') toast('Its caption is copied, ready to paste.');
      } catch (_) { toast('This phone can’t make the clip. It plays in the Log.'); }
      finally { if (endClipFound === f) { k.removeAttribute('aria-busy'); $('endClipAct').textContent = 'Share clip'; } }
    });
    $('endShare').addEventListener('click', async () => {
      if (!endDrive || !window.ApexDriveCard || $('endShare').getAttribute('aria-disabled') === 'true') return;   // U-118: still scoring
      // F-04: the picture's model came with the score from the worker (the drive's shape and corner mix); a whole record
      // shown here is drawn from itself
      const model = endDrive.card || (endDrive.record ? ApexDriveCard.cardModel(endDrive.record) : null);
      if (!model) return;
      const css = getComputedStyle(document.documentElement), v = (k) => css.getPropertyValue(k).trim();
      const cv = ApexDriveCard.drawCard(document.createElement('canvas'), model,
        { panel: v('--panel'), panelInk: v('--panel-ink'), panelDim: v('--panel-dim'), accent: v('--accent'), fontNum: v('--font-num'), fontUi: v('--font-ui') },
        { car: look.theme.car && look.theme.car.silhouette ? { silhouette: look.theme.car.silhouette, paint: look.theme.car.paint && look.theme.car.paint.hex, name: look.theme.label } : null });
      const out = await ApexDriveCard.shareCard(cv, `${(endDrive.name || 'drive').replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'drive'}.png`);
      if (out === 'saved') toast('Card saved.');
    });
    // U-75: a drive on a planned route is named after the route the driver chose (they will look for it under that name); a
    // free drive after the road that carried most of it (road_names.js), else the date and time
    function driveName(road, when) {
      const routeName = track && track.kind === 'route' && typeof track.name === 'string' ? track.name.trim() : '';
      return routeName || road || `Drive ${when.toLocaleDateString()} ${ApexFormat.clock12(when.getHours(), when.getMinutes())}`;
    }
    // ended: why a drive ended itself ('car', 'parked'; drive_keep.js EndWatch), or nothing for End
    async function leaveDrive(save, ended) {
      if (pendingEnd) { clearTimeout(pendingEnd.timer); pendingEnd = null; paintEndUndo(); }   // I-3: any other way out ends it now
      driveActive = false; driveCam(false); pushQuiet(false); soundtrackStop(); drive.wet = null; if (ApexNoteTiming.setRoad) ApexNoteTiming.setRoad(null);   // the dry road back
      const kept = keepStop();                                         // Round 3: no more checkpoints; dropped once saved
      stageWatch = null; $('stageBar').hidden = true; coachWatch = null; $('coachBar').hidden = true;
      const laps = circuit.timer ? circuit.timer.state(Date.now()).laps : [];
      const battery = window.ApexBattery ? ApexBattery.summary(drive.battery) : null; drive.battery = null;
      resetCircuit();
      activity('end');
      forgetActive();                                                  // the drive is over: a relaunch starts with no route
      carPost({ kind: 'end' }); car.guideKey = ''; car.sightKey = '';
      // U-62: after End the car goes idle; the finished route was offered again as a trip preview ("Dry Ridge Rd · Drive")
      if (track && track.kind === 'route') { car.ended = track; carRoute(null); }
      // In the app the mounted phone's own stream (feedAmbient) carries a recorded drive's road feel. When it ran during
      // this drive, the drive is shared (or waits for signal), so the Log doesn't offer it again by hand.
      const nativeShared = (() => { const a = drive.native && ambient.allowed ? ambientStats() : null; return !!(a && (a.active || a.trips > (drive.ambientTrips || 0))); })();
      const rec = drive.rec, sensors = drive.sensors, live = drive.live, road = rec && window.ApexRoadNames ? ApexRoadNames.mainRoad(drive.roads, rec.km * 1000) : null;
      drive.sensors = null; drive.rec = null; drive.live = null; drive.share = 'off'; drive.native = false;
      if (sensors) sensors.stop();
      state.live = null;
      refreshAutoNight();
      if (track && track.kind === 'horizon') { track = null; if (plannedRoute) activate(plannedRoute, 0, { quiet: true }); }   // the road ahead ends with the drive
      replayOn = false; setMode(track && track.kind === 'route' ? 'sim' : 'replay'); paintModeSwitch(); render(true);
      if (save && rec && ApexDriveKeep.keepable(rec)) {
        // said in the Log and on the card (drive_keep.js endNote); the car it was driven in (IDEAS D-19: its label and the
        // grip its score allows, never higher than the street default); lap times from track mode (on a circuit only,
        // IDEAS D-15); what the drive cost the battery (IDEAS P-01)
        const car = routingCar(), extra = {};
        if (ended) extra.ended = ended;
        if (car) extra.car = { label: car.label, mu: Core.carGrip(car) };
        // Passenger aboard (For this drive) tags the drive 'Passenger' (drive_tags.js), so the Log knows it too
        { const tags = window.ApexRouteDriver ? ApexRouteDriver.driveTags(ApexRouteDriver.load(localStorage)) : []; if (tags.length) extra.tags = tags; }
        if (laps.length) extra.laps = laps;
        if (battery) extra.battery = battery;
        { const sf = drive.surface ? drive.surface.value() : null; if (sf) extra.surface = sf; }   // dry, wet or icy (road_surface.js); unknown left out
        // F-04: the card in the frame after End, from the recording as it stands; the drive is parsed, scored and saved in
        // the analysis worker (analysis_client.js save), and the card gets its score when that lands
        const job = driveJob(rec, (when) => driveName(road, when));
        const card = endCardFacts(rec, job, extra);
        card.feel = window.ApexRoadFeel ? ApexRoadFeel.summary(ApexRoadFeel.columns(rec.rows)) : null;   // HE-1
        card.surface = extra.surface || null;
        endCardOpen(card);
        try {
          const { rows: _, ...recState } = rec.snapshot(rec.samples);
          const res = await ApexAnalysis.job('save', { state: recState, rows: rec.rows, fileName: job.fileName, meta: job.meta, extra, plan: practicePlan(), segs: savedStages() });
          keepDone(kept);
          const s = res.summary || {};
          endCardScored({ ...card, id: res.driveId, len_m: s.len_m ?? card.len_m, secs: s.secs ?? card.secs, corners: Array.isArray(s.corners) ? s.corners.length : null,
                          ds: s.ds || { score: null, components: null }, card: res.card || null, coach: res.coach || null, practice: res.practice || null, stages: res.stages || [] }, res.others || [], { quiet: !!ended });
          idle(() => refreshSavedDrives().catch(() => {}));            // the road memory learns this drive, off the card's moment
          if (live) {
            live.finish().then(async (shared) => {
              // what had no signal to go with waits on the phone (road_carry.js): said, so a drive in the hills doesn't look unshared
              const waitM = window.ApexRoadCarry && ApexRoadCarry.itemM && live.leftover ? ApexRoadCarry.itemM(live.leftover()) : 0;
              const waits = waitM >= 100 ? ApexUnits.long(waitM, 1) : null;
              // shared, or waiting to go by itself: either way the Log must not offer it by hand (the pass would be merged twice)
              if ((shared && shared.chunks > 0) || waits) await ApexAnalysis.job('patch', { id: res.driveId, fields: { contributed: true } });
              if (shared && shared.chunks > 0) {
                if (shared.km > 0) toast(waits ? `Shared ${ApexUnits.long((shared.km) * 1000, 1)} of road feel. ${waits} more waits for signal.` : `Shared ${ApexUnits.long((shared.km) * 1000, 1)} of road feel.`);
              } else if (waits) toast(`${waits} of road feel waits for signal. It goes when you're back online.`);
            }).catch(() => {});
          } else if (nativeShared) ApexAnalysis.job('patch', { id: res.driveId, fields: { contributed: true } }).catch(() => {});
        } catch (e) {
          if (endDrive && endDrive.id === card.id) $('endCard').classList.remove('show');   // nothing was saved: no card for it
          toast(e && /Quota/.test(e.name || e.message || e) ? 'Couldn\'t save this drive. The phone is out of storage.' : 'Couldn\'t save this drive.'); console.error('save drive', e);
          if (live) live.finish().catch(() => {});
        }
      } else if (save && rec && rec.samples > 0) {
        keepDone(kept);
        if (!ended) toast(`Too short to save. Drives under ${ApexUnits.metric() ? '0.3 km' : '0.2 mi'} are dropped.`);
        if (live) live.finish().catch(() => {});
      } else {
        keepDone(kept);
        if (live) live.finish().catch(() => {});
      }
    }
    // A recording as the Log keeps it, named for the moment it started (the same id however it was saved, so a drive saved
    // twice, by End and again by recovery after the app closed at the wrong moment, is one drive)
    function driveJob(rec, nameAt) {
      const when = new Date(rec.startedAt || Date.now()), pad = (n) => String(n).padStart(2, '0');
      const stamp = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}_${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
      const fileName = `web_${stamp}.csv`;
      return { fileName, id: 'rec_' + fileName.replace(/\W+/g, '_'),     // the id ApexRecording.parse gives it
               meta: { source: 'web-gps', ...(Number.isFinite(rec.startedAt) ? { t0: rec.startedAt } : {}), date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`, name: nameAt(when) } };
    }
    // What the end card can say before the drive is parsed (F-04): its name, the distance and time its own rows give (as
    // the Log will count them), and its trail. No corner count and no score until they are measured.
    function endCardFacts(rec, job, extra) {
      const rows = rec.rows, n = rows.length, lat = new Array(n), lon = new Array(n), v = new Array(n), elev = new Array(n), dist = new Array(n);
      for (let i = 0; i < n; i++) { const r = rows[i]; lat[i] = r.lat; lon[i] = r.lon; elev[i] = Number.isFinite(r.elevation_m) ? r.elevation_m : null; dist[i] = r.distance_m; v[i] = Number.isFinite(r.speed_mps) ? r.speed_mps : NaN; }
      let secs = null;
      try { const T = Core.elapsedS(v), s = T[T.length - 1]; secs = Number.isFinite(s) ? s : null; } catch (_) { secs = null; }
      return { id: job.id, name: job.meta.name, ended: extra.ended, len_m: n ? rows[n - 1].distance_m : null, secs, lat, lon, elev, dist, corners: null, ds: null };
    }

    // In-car mode (web/in_car.js, IDEAS C-07 / C-08): big targets and no keyboard while the car moves. A tap on a text field
    // explains and offers "I'm a passenger", which unlocks typing until the car next stops.
    const motion = new ApexInCar.MotionGate();
    let passenger = false;
    function paintMoving() {
      if (!motion.moving) passenger = false;
      const on = motion.moving && !passenger;
      document.body.classList.toggle('moving', on);
      if (on && ApexInCar.opensKeyboard(document.activeElement)) document.activeElement.blur();
    }
    function feedMotion(speedMps) { if (motion.update(speedMps, performance.now())) paintMoving(); }
    setInterval(() => { if (motion.tick(performance.now())) paintMoving(); }, 2000);
    document.addEventListener('focusin', (e) => {
      if (!document.body.classList.contains('moving') || !ApexInCar.opensKeyboard(e.target)) return;
      e.target.blur();
      if ($('toast')._holdUntil > performance.now()) return;   // never take over a Cancel countdown (a reroute, a detour)
      toast('Typing is off while the car moves.', { label: 'I\'m a passenger', ms: 6000, onClick: () => {
        passenger = true; paintMoving(); setTimeout(() => toast('Passenger mode: typing is on until the car stops.'), 0);
      } });
    });

    const flag = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) {} return null; };
    async function watchDryRidge() {
      if (!drives.some(x => x.id === 'dry_ridge')) toast('Loading the replay…');
      await loadDemos();
      const d = drives.find(x => x.id === 'dry_ridge');
      if (!d) { toast('Couldn\'t load the replay. Check the connection and try again.'); return; }
      booting = false; replayOn = true; closeSheet(); activate(d, 0);
      replayWhenReady(d);                                              // "Watch" plays it (walkthrough 2026-11-11: it sat at 0 mph until Play)
    }
    // CarPlay's "Start drive" offer (IDEAS C-05) holds the toast for 10 s: once a drive starts it is moot, so it goes
    // and stops holding back other toasts.
    let carOfferUntil = 0;
    function clearCarOffer() {
      const t = $('toast');
      if (!carOfferUntil || t._holdUntil !== carOfferUntil) return;
      carOfferUntil = 0; t._holdUntil = 0; t.classList.remove('show'); t.querySelectorAll('a').forEach(x => x.remove());
    }
    // A go=drive link (a Shortcuts automation) can't start without location: say so rather than do nothing.
    function driveFromLink() { startDrive(); }   // with Location off, startDrive says so and shows the way back
    // From the car's screen (CarPlay/ApexCarPlay.swift). Nothing here asks the driver to use the phone: no explainer sheet
    // (the system's own location prompt is the only one, and only if it was never answered).
    function carAction(m) {
      if (m.action === 'go' && Number.isFinite(m.lat) && Number.isFinite(m.lon) && !driveActive) carAsked(() => routeToPlace({ label: String(m.name || 'Destination').slice(0, 80), lat: m.lat, lon: m.lon }));
      else if (m.action === 'pick' && Number.isInteger(m.i)) pickOption(m.i);
      else if (m.action === 'start' && state.mode !== 'live' && !locDenied) {
        // U-79: the idle map's Drive is a free drive. The car shows no route then, so one the phone still holds (the route just
        // driven, U-62) is put away rather than guided along unseen; the preview's own Drive (no `free`) drives the route.
        if (m.free === true && car.route === '' && track && track.kind === 'route') clearPlanned();
        closeWelcome();                                              // U-65: a first drive from the car
        keepCar(true);                                               // Round 3: the car's screen is there, so the car is on
        enterDrive();
      }
      else if (m.action === 'end' && driveActive) { if (pendingEnd) commitEnd(); else askEnd(); }   // I-3: the car's End has the Undo window too; End again ends now
      else if (m.action === 'undo') undoEnd();
      else if (m.action === 'offer' && car.offer && m.id === car.offer.id && performance.now() < car.offer.until) car.offer.run();
      else if (m.action === 'disconnect') keepCar(false, m.t);      // Round 3: the car switched off; the drive ends once it stays put
      else if (m.action === 'places') carPost(carPlaces());
      else if (m.action === 'nearby' && window.ApexNearby && ApexNearby.CATS[m.cat]) {     // a kind from the car's Places: the phone's Find nearby list
        const cat = m.cat;
        nearbyFor(cat).then(({ rows, failed }) => carPost(ApexCarPlay.nearbyMessage(cat, ApexNearby.CATS[cat].label, rows, (d) => ApexUnits.long(d),
          ApexNearby.emptyLine(cat, failed, 8, (d) => ApexUnits.long(d))))).catch(() => carPost(ApexCarPlay.nearbyMessage(cat, ApexNearby.CATS[cat].label, [], null, ApexNearby.emptyLine(cat, true))));
      }
      else if (m.action === 'attack' && !driveActive) {                  // a time attack you've entered, from the car's Places
        const c = car.attacks.find((x) => String(x.segment_id) === String(m.id));
        let g = [];
        try { g = c ? JSON.parse(c.geom) || [] : []; } catch (_) {}
        if (g.length > 1) driveAttack(c, g).catch(() => {});
      }
      else if (m.action === 'saved' && typeof m.id === 'string' && !driveActive) {      // a saved route from the car's Places
        const p = ApexSavedRoutes.list(localStorage).find((q) => q.id === m.id);
        if (p) openSaved(p).catch(() => {});
      }
      // Add a stop from the car: the list of what's ahead, then the one picked, only one that list had (the route's own places)
      else if (m.action === 'stops') carPost(ApexCarPlay.stopsMessage(track && track === plannedRoute && track.kind === 'route' ? track.scenic : null,
        state.mode === 'live' ? routeWatch.bestM : state.cursorM, (d) => ApexUnits.long(d, 1, true)));
      else if (m.action === 'stop' && Number.isFinite(m.lat) && Number.isFinite(m.lon) && track && track === plannedRoute) {
        const p = (track.scenic || []).find((x) => Math.abs(x.lat - m.lat) < 1e-6 && Math.abs(x.lon - m.lon) < 1e-6);
        if (p) carAsked(() => addViaAt({ lat: p.lat, lon: p.lon, label: (p.name || '').trim() || String(m.name || 'Stop').slice(0, 40) }, p.m));
      }
      else if (m.action === 'loop' && LOOP_MINUTES.includes(m.minutes) && !driveActive) carAsked(() => loop({ minutes: m.minutes }));
      // a distance from the car's Loops list: only one the dial has (miles, or kilometres kept as miles)
      else if (m.action === 'loop' && Number.isFinite(m.miles) && !driveActive
               && [...ApexCarPlay.LOOP_MI, ...ApexCarPlay.LOOP_KM.map((km) => km / 1.609344)].some((x) => Math.abs(x - m.miles) < 0.01)) carAsked(() => loop(m.miles));
      else if (m.action === 'report' && ApexHazardReports.KINDS.includes(m.kind)) carAsked(() => reportHazard(m.kind, null, true));
      else if (m.action === 'still' && typeof m.still === 'boolean') answerStill(m.still);
      else if (m.action === 'voice') { state.toggles.voice = !state.toggles.voice; savePrefs(); paintSwitches(); if (!state.toggles.voice) stopSpeaking(); }
      else if (m.action === 'hello') { keepCar(true); car.route = ''; car.look = ''; car.hazards = null; car.limitKey = ''; carRoute(track && track.kind === 'route' ? track : null); carLook(); carHazards();
        carPost(carPlaces());                   // a car screen that just connected gets everything again
        carPost(ApexCarPlay.loopsMessage(loopBy, ApexUnits.metric()));   // and the loop dial's lengths for its Loops
        peekTimeAttack();                                                // and this week's loop for its Places, if you've entered it
        if (driveActive) { carPost({ kind: 'start', title: track && track.kind === 'route' ? String(track.name || 'Route').slice(0, 80) : 'Drive' }); car.guideKey = ''; } }   // and the drive in progress (U-59)
    }
    carPost(carPlaces());
    function startDrive() {
      if (state.mode === 'live') return;
      askLocation();                                                   // never asked (a welcome skipped by a link): ask now
      if (flag('apex.permsExplained') && !locDenied) { enterDrive(); return; }
      showPerms();
    }
    function showPerms() {
      paintPerms();
      // The app calibrates the mount (ApexKit); a browser has no mount calibration, so the tip is app-only
      document.querySelectorAll('.mount-row').forEach(n => { n.hidden = !NATIVE_SHELL; });
      const sheet = $('permSheet'); sheet.classList.add('show'); $('permGo').focus();
    }
    $('permGo').addEventListener('click', () => {
      if (locDenied && NATIVE_SHELL) { try { window.webkit.messageHandlers.apex.postMessage({ cmd: 'openSettings' }); } catch (_) {} return; }   // the sheet stays: it closes itself when Location comes on
      flag('apex.permsExplained', '1'); $('permSheet').classList.remove('show'); enterDrive();   // a browser asks again: on if it was allowed since, this sheet again if not
    });
    $('permNo').addEventListener('click', () => $('permSheet').classList.remove('show'));
    $('startDrive').addEventListener('click', startDrive);
    // P-11: Start's other way to go. A crew's convoy starts from its drive's card; this is the one for two friends met at a
    // petrol station: a convoy now, no crew, its code on the screen for them to scan.
    $('startMore').addEventListener('click', () => {
      if (state.mode === 'live') return;
      const back = el('div', { className: 'overlay dim show start-sheet' });
      back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true'); back.setAttribute('aria-label', 'Ways to go');
      const close = () => { back.remove(); document.removeEventListener('keydown', esc); };
      const esc = (e) => { if (e.key === 'Escape') close(); };
      const drive = el('button', { className: 'rec-key' }, el('i'), 'Just drive');
      drive.addEventListener('click', () => { close(); startDrive(); });
      const name = (accountMe && accountMe.handle ? `@${accountMe.handle}'s convoy` : 'Convoy');
      back.append(el('div', { className: 'card-sheet' }, el('h2', { textContent: 'Ways to go' }), drive,
        btn('Convoy now', () => { close(); needSocial().then(() => { if (convoy) convoy.now(name); else toast('The convoy isn\u2019t available here.'); }); }, 'ink-btn'),
        // IDEAS S-22: a friend's convoy, by the code they read out (the convoy sheet's Join code field)
        btn('Join with a code', () => { close(); needSocial().then(() => { if (convoy) convoy.open(); else toast('The convoy isn\u2019t available here.'); }); }, 'ink-btn'),
        // TestFlight 2026-11-12 (note 6, the owner circled it): no paragraph under the keys; the convoy sheet says the rest
        btn('Cancel', close, 'linkbtn')));
      onBackdrop(back, () => close());
      document.addEventListener('keydown', esc);
      document.body.append(back);
      drive.focus({ preventScroll: true });   // TestFlight 2026-11-05: focusing mid-slide scrolled the sheet up past its place (keyboard.js)
    });
    $('trialStop').addEventListener('click', () => endThemeTrial(false));
    $('trialWatch').addEventListener('click', () => { watchDryRidge().then(paintTrial); });
    // the plate's × and (U-104) the transport's Done close a replay or a preview alike
    // D-3 (panel round 1): Done gives the app back whatever mode the page was in. Only a drive in progress keeps the plate (it
    // reads "Drive ● Rec" then); a page left in 'live' with no drive behind it (frames that stopped) goes back to the replay
    // mode, and the idle deck, the tabs and the plan bar come back with it.
    const closeReplay = () => {
      if (driveActive) return;
      if (!replayOn && state.mode !== 'live') return;
      const wasReplay = state.mode === 'replay' && !(track && track.kind === 'route');
      replayOn = false; setPlaying(false);
      if (state.mode === 'live') { state.live = null; setMode(track && track.kind === 'route' ? 'sim' : 'replay'); paintModeSwitch(); }
      paintIdle(); measurePlanBar();
      // walkthrough 2026-11-11: Done after a replay (the welcome's demo, a Log drive) left the map and the arrow on that
      // drive's ground, hundreds of miles off, while the masthead and the cards spoke of where you are; a still browser sends
      // no new fix to bring it back. The idle map goes back to your last known position, at once. A route's fly-through keeps
      // its route in view (unchanged); no position known leaves the map where it is.
      const here = state.lastPosition;
      if (wasReplay && here && Number.isFinite(here.lat) && Number.isFinite(here.lon)) {
        const m = state.lastMotion || {};
        clearTimeout(resumeTimer); clearInterval(resumeTick); state.follow = true; $('recenterBtn').classList.remove('show');
        idleSnapped = false;
        showIdleFix({ lat: here.lat, lon: here.lon, course_deg: Number.isFinite(m.heading) ? m.heading : NaN, speed_mps: 0 });
      }
    };
    $('modePlate').addEventListener('click', closeReplay);
    $('replayDone').addEventListener('click', closeReplay);
    // I-3 (panel round 1): End can't be a mis-tap. It sat 6 pt from Report and ended the drive at once. Now End says so in
    // the status row and its own key turns Undo for END_UNDO_MS, with a fill running down; the sensors, the notes and the
    // car keep going meanwhile, so Undo resumes as if End was never tapped. No dialog while moving (NHTSA counts those).
    // When the time runs out the drive is saved as it stood at End (the rows after it dropped, as a parked end does).
    const END_UNDO_MS = 1700;   // the owner, 2026-11-03: a third of the 5 s it was
    let pendingEnd = null;                                            // { timer, rows }: End tapped, not yet done
    function paintEndUndo() {
      const b = $('driveEnd'), on = !!pendingEnd;
      b.textContent = on ? 'Undo' : 'End';
      b.setAttribute('aria-label', on ? 'Undo End: keep driving' : 'End drive');
      b.classList.toggle('undo', on);
      b.style.setProperty('--end-undo-ms', `${END_UNDO_MS}ms`);
    }
    function commitEnd() {
      const p = pendingEnd;
      if (!p) return;
      clearTimeout(p.timer); pendingEnd = null; paintEndUndo();
      if (!driveActive) return;
      if (drive.rec && Number.isFinite(p.rows)) drive.rec.truncate(p.rows);
      leaveDrive(true);
    }
    function askEnd() {
      if (pendingEnd) { undoEnd(); return; }                          // the same key again is Undo: a second bump undoes
      if (!driveActive) { leaveDrive(true); return; }
      haptic('note');                                                  // a mis-tap is felt
      pendingEnd = { rows: drive.rec ? drive.rec.samples : null, timer: setTimeout(commitEnd, END_UNDO_MS) };
      soundtrackStop();                                                // End: the music stops at the tap, not at the next frame
      paintEndUndo();
      driveNote(`Drive ended. Saving it in ${Math.round(END_UNDO_MS / 1000)} seconds.`);
      carPost({ kind: 'ending', seconds: END_UNDO_MS / 1000 });
    }
    function undoEnd() {
      if (!pendingEnd) return;
      clearTimeout(pendingEnd.timer); pendingEnd = null; paintEndUndo();
      driveNote('Still recording.');
      carPost({ kind: 'resumed' });
    }
    $('driveEnd').addEventListener('click', askEnd);
    if (window.apexDebug) window.apexDebug.endNow = commitEnd;       // the smoke test: the window run out, without the wait

    // =======================================================================
    // 10c. FIRST RUN: one screen, shown once, on the web and in the app. In the app its Start is what asks for location
    // (U-65); motion and the explainer wait for the first Start drive.
    // =======================================================================
    // First run is one screen (REVIEW.md roadmap 8): the mark, a line, the road book calling corners on a loop, Start.
    // The voice comes with the theme and sign-in waits for the first social action, so neither is asked here.
    // P-2 / M-3 (panel round 1): in the driver's words, the head and the next cells alike (a new driver gets plain words, so
    // the welcome says "Tight right, long" beside "EASY L", never "Right 5" beside "L4")
    const OB_NOTES = [
      { type: 'corner', dir: 'L', severity: '4', mods: ['tightens'], call: 'Left 4 tightens', code: 'L4', dist: '300', unit: 'ft' },
      { type: 'corner', dir: 'R', severity: '3', mods: [], call: 'Right 3', code: 'R3', dist: '150', unit: 'ft' },
      { type: 'crest', dir: null, severity: null, mods: [], call: 'Crest', code: 'CREST', dist: '200', unit: 'ft' },
      // U-105: calls that read whole in the welcome's narrow lead box ("LEFT HAIRP…" was the one cut word on the page)
      { type: 'corner', dir: 'L', severity: '2', mods: [], call: 'Left 2', code: 'L2', dist: '400', unit: 'ft' },
      { type: 'corner', dir: 'R', severity: '5', mods: ['long'], call: 'Right 5 long', code: 'R5', dist: '250', unit: 'ft' },
    ];
    const obNote = (n) => (state.noteWords === 'plain' && window.ApexPlainNotes ? { ...n, call: ApexPlainNotes.plainCall(n) } : n);
    function runOnboarding() {
      const ob = $('onboard');
      let k = 0, intro = null;
      // the strip calls the next corner and the red dot on the drawn road drives up to it (first_run.js), every 1.8 s; with
      // reduced motion the page is still: the first call, the dot at the start
      const tick = () => {
        if (!ob.classList.contains('show')) return;
        const page = [0, 1, 2].map(j => ({ ...obNote(OB_NOTES[(k + j) % OB_NOTES.length]), key: k + j }));
        page.words = state.noteWords;
        Inst.renderNotes($('obNotes'), look.theme, page);
        if (intro) intro.step(k);
        k++;
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(tick, 1800);
      };
      // U-65: in the app the system's location sheet follows the welcome's Start, so it comes after a reason, not at launch
      const finish = () => { flag('apex.onboarded', '1'); ob.classList.remove('show'); askLocation(); };
      $('obNext').onclick = finish;
      $('obAlt').onclick = () => { finish(); watchDryRidge(); };
      // Focus the dialog, not its button: VoiceOver reads the welcome, and no focus ring sits on Start before a touch
      ob.classList.add('show');
      if (window.ApexFirstRun) intro = ApexFirstRun.attach(ob);
      tick(); ob.tabIndex = -1; ob.focus();
    }
    setTimeout(() => health.flush(IN_APP_SHELL ? 'ios' : 'web').catch(() => {}), 5000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') health.flush(IN_APP_SHELL ? 'ios' : 'web').catch(() => {}); });
    // The shell asks for location only when the page says (ApexNavApp.swift requestLocation): after the welcome, at once for a
    // driver past it, or at the first Start drive. Asked before and answered, the system shows nothing.
    function askLocation() {
      if (!NATIVE_SHELL) return;
      try { window.webkit.messageHandlers.apex.postMessage({ cmd: 'requestLocation' }); } catch (_) {}
    }
    // A first drive started from the car while the welcome waits on the phone: the drive is the answer to it, and location
    // is asked now (the phone shows the sheet).
    function closeWelcome() {
      if ($('onboard').classList.contains('show')) { flag('apex.onboarded', '1'); $('onboard').classList.remove('show'); }
      askLocation();
    }
    const wasOnboarded = !!flag('apex.onboarded');
    // U-65: the welcome runs in the app too (it was web only from the first import, when the shell asked for location at
    // launch and its sheet would have covered the welcome; the shell now waits for askLocation). A link that opened the app
    // for something still goes straight to it.
    // P-1 (panel round 1): a crew, friend or invite link is a newcomer's way in, so it opens the welcome first (one more line
    // says the link waits), and the link's own side of People is under it when Start closes it (renderAccount opens it).
    const linkIn = ['crew', 'invite', 'add'].find(k => params.has(k));
    if (!flag('apex.onboarded') && linkIn) { $('obLink').textContent = linkIn === 'crew' ? 'A crew link is waiting. It opens after Start.' : 'A friend’s link is waiting. It opens after Start.'; $('obLink').hidden = false; }
    if (!flag('apex.onboarded') && !['convoy', 'drive', 'play', 'at', 'theme', 'go'].some(k => params.has(k))) runOnboarding();
    else if (!flag('apex.onboarded')) flag('apex.onboarded', '1');     // a link's first open: location waits for a Start drive
    else askLocation();
    // What's new after an update (IDEAS O-10; web/whats_new.js): once, a moment after the page settles, never over a drive or a
    // link that opened the app for something; a first install only marks it seen.
    (() => {
      if (!window.ApexWhatsNew || window.APEX_EMBED) return;
      if (!wasOnboarded) { ApexWhatsNew.markSeen(localStorage); return; }
      const busy = ['invite', 'crew', 'add', 'convoy', 'drive', 'play', 'at', 'theme', 'go', 'view'].some(k => params.has(k));
      const news = ApexWhatsNew.pending(ApexWhatsNew.seen(localStorage), wasOnboarded, busy);
      if (!news) return;
      // never over something you've started (whats_new.js moment): a touch or a key before it is up, a sheet, the plan
      // panel or a drive, and it waits for the next launch; while the splash is up it waits for the map
      let touched = false, tries = 0;
      const mark = () => { touched = true; };
      const KEYS = ['pointerdown', 'keydown'];
      for (const k of KEYS) window.addEventListener(k, mark, { capture: true, once: true });
      const stop = () => { for (const k of KEYS) window.removeEventListener(k, mark, { capture: true }); };
      const anythingOpen = () => !!document.querySelector('.overlay.show, .side-pop.open, #planPanel.open, .sheet.open') || state.mode === 'live';
      const tryNow = () => {
        const m = ApexWhatsNew.moment({ touched, driving: driveActive, splash: !!$('boot'), open: anythingOpen() });
        if (m === 'wait' && ++tries < 40) { setTimeout(tryNow, 400); return; }
        stop();
        if (m === 'show') ApexWhatsNew.show(el, news, () => ApexWhatsNew.markSeen(localStorage));
      };
      setTimeout(tryNow, 1200);
    })();

    // An invite, crew, friend or convoy link opened in iPhone Safari: offer to open it in the app instead (apexnav://open?...).
    // Only the link keys go across, and only values the app accepts; the app checks them again.
    (() => {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (window.APEX_EMBED || !ios) return;
      const q = new URLSearchParams();
      for (const k of ['invite', 'crew', 'add', 'convoy', 'roadbook']) { const v = params.get(k); if (v && /^[A-Za-z0-9._-]{1,200}$/.test(v)) q.set(k, v); }
      try { if (![...q.keys()].length || sessionStorage.getItem('apex.stayInBrowser')) return; } catch (_) { if (![...q.keys()].length) return; }
      const bar = document.createElement('div');
      bar.id = 'openInApp';
      bar.style.cssText = 'position:fixed;left:50%;bottom:calc(76px + var(--safe-bottom, 0px));transform:translateX(-50%);z-index:40;display:flex;gap:12px;align-items:center;' +
        'background:var(--panel);color:var(--panel-ink);border:1px solid var(--rule);padding:10px 14px;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:calc(100% - 32px)';
      const a = document.createElement('a'); a.href = 'apexnav://open?' + q.toString(); a.textContent = 'Have the app? Open it there'; a.style.cssText = 'color:var(--accent);font-weight:600;white-space:nowrap';
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Stay in the browser'); x.className = 'linkbtn';
      x.onclick = () => { bar.remove(); try { sessionStorage.setItem('apex.stayInBrowser', '1'); } catch (_) {} };
      // Get the app (launch marketing, 2026-11-14): the App Store with a campaign tag (ct), so App Store Connect's own counts
      // say which kind of link brought them; no tracking SDK. Hidden until the owner sets the app's id and provider token.
      const APP_STORE_ID = null, APP_STORE_PT = null;                  // App Store Connect: the app's Apple ID (digits), the provider token (pt)
      const ct = q.has('roadbook') ? 'route-share' : q.has('crew') ? 'crew' : q.has('convoy') ? 'convoy' : 'invite';
      const kids = [a];
      if (/^\d{6,12}$/.test(String(APP_STORE_ID || '')) && /^\d{1,12}$/.test(String(APP_STORE_PT || ''))) {
        const g = document.createElement('a'); g.href = `https://apps.apple.com/app/id${APP_STORE_ID}?pt=${APP_STORE_PT}&ct=${ct}&mt=8`;
        g.textContent = 'Get the app'; g.style.cssText = 'font-weight:600;white-space:nowrap'; kids.push(g);
      }
      bar.append(...kids, x); document.body.append(bar);
    })();

    // =======================================================================
    // 11. NATIVE BRIDGE (ApexNavApp.swift pushes window.apex.live every 0.1 s)
    // =======================================================================
    // The app (ApexNavApp.swift) pushes a frame every 0.1 s from launch, driving or not. Its frames always update the
    // position (idle puck, Plan, Night); they take over the screen only while a drive runs (Start drive → End drive).
    // In a browser, frames come from the web sensors during a drive (or from tests) and go straight to live mode.
    // iOS ignores user-scalable=no: cancel Safari's page-zoom gesture. MapLibre's pinch uses touch events and keeps working.
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    // the focus ring is for the keyboard: it shows once a key has been pressed to move focus, never after a tap or a sheet's own focus()
    document.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) document.documentElement.classList.add('kbd'); }, true);
    document.addEventListener('pointerdown', () => document.documentElement.classList.remove('kbd'), true);
    // An invite, crew, friend or convoy link opened while the app is running: take it in place (never reload mid-drive) and
    // show it on its side of People, where each one still waits for a tap.
    function openAppLink(p) {
      const ok = (v) => typeof v === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(v);
      try {
        if (ok(p.invite)) sessionStorage.setItem('apex.invite', p.invite);
        if (ok(p.crew)) sessionStorage.setItem('apex.crew', p.crew);
        if (ok(p.add)) sessionStorage.setItem('apex.add', p.add.toLowerCase());
      } catch (_) {}
      if (ok(p.convoy)) needSocial().then(() => { if (convoy && convoy.takeInvite) convoy.takeInvite(p.convoy); });
      if (ok(p.roadbook)) { openRoadbookLink(p.roadbook); return; }      // a roadbook someone sent: its page
      if (ok(p.road)) { closeSheet(); openRoadLink(p.road); return; }   // DA-4: a road someone sent, as a route card
      // apexnav://open?go=drive (a Shortcuts automation, IDEAS C-05); go=report and go=end from Siri (IDEAS V-07), during a drive only
      if (p.go) {
        if (p.go === 'drive') { closeSheet(); driveFromLink(); }
        else if (p.go === 'report') { if (state.mode === 'live') { closeSheet(); $('hzOverlay').classList.add('show'); } else toast('Start a drive to report a hazard.'); }
        else if (p.go === 'end') { if (state.mode === 'live') leaveDrive(true); else toast('No drive to end.'); }
        else if (p.go === 'nextstage') nextStageAnswer();
        else if (p.go === 'skipstage') skipStage();
        else if (p.go === 'nextfuel' || p.go === 'nextcafe') nextPlaceAnswer(p.go === 'nextfuel' ? 'fuel' : 'cafe');
        else spokenLink(p.go, p.q);
        return;
      }
      // a push's tap (backend/src/push.ts): the post it is about, or the friend, or People's side
      showView(ok(p.crew) || ok(p.convoy) || p.view === 'crews' ? 'crews' : 'friends');
      if (ok(p.post)) needSocial().then(() => { if (drivePosts) drivePosts.open(p.post); });
      if (ok(p.friend) && /^[A-Za-z0-9_]{3,20}$/.test(p.friend)) window.apexOpenFriend(p.friend.toLowerCase()); else renderAccount();
    }
    // Siri: go=to with the place said (q, base64url UTF-8: ApexIntents.swift linkWords), go=loop60 for "Find a 1 hour loop".
    // Through carAsked, so a place that can't be found or planned says why on the car's screen too.
    function linkWords(b) {
      if (typeof b !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(b)) return '';
      try { const bin = atob(b.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); } catch (_) { return ''; }
    }
    function spokenLink(go, q) {
      const loopMin = /^loop(\d{2,3})$/.exec(go || '');
      if (go === 'to') carAsked(() => goSpoken(linkWords(q)));
      else if (loopMin && LOOP_MINUTES.includes(+loopMin[1])) {
        if (driveActive) toast('End the drive to find a loop.');
        else { closeSheet(); carAsked(() => loop({ minutes: +loopMin[1] })); }
      }
    }
    // Siri (IDEAS V-07): "how far to the next stage" says it aloud; "skip this stage" drops the stage you're on or the next
    // one and reroutes to your next stop or the destination (only on a fun route with stages, during a drive).
    function nextStageAnswer() {
      const t = track, at = state.mode === 'live' ? routeWatch.bestM : state.cursorM;
      const n = t && t.stageSpans ? FunRoute.stageAhead(t.stageSpans, Number.isFinite(at) ? at : 0) : null;
      const line = !t || !t.stageSpans ? 'This route has no stages.' : !n ? 'No more stages on this route.'
        : n.on ? `On ${n.span.name || 'a stage'} now: ${ApexUnits.long(n.toM, 1)} to go.` : `Next stage${n.span.name ? `, ${n.span.name},` : ''} in ${ApexUnits.long(n.toM, 1)}.`;
      toast(line); say(line, true);
    }
    // Siri (the owner, 2026-11-11): "where's the next gas station / café" says the next one along the planned route by
    // its name on the map (scenic.js nextAnswer); no route, or its places not loaded, says so.
    function nextPlaceAnswer(kind) {
      const t = track, at = state.mode === 'live' ? routeWatch.bestM : state.cursorM;
      const list = t && t === plannedRoute && Array.isArray(t.scenic) ? t.scenic : null;
      const car = routingCar(), k = kind === 'fuel' && car && car.fuel === 'electric' ? 'charge' : kind;   // "next gas station" in an EV: the next charger
      const line = window.ApexScenic ? ApexScenic.nextAnswer(list, at, k, { long: (m) => ApexUnits.long(m, 1, true) }) : '';
      if (line) { toast(line); say(line, true); }
    }
    // (span: the one to skip, a late loop's offer; none: the one you're on or the next)
    function skipStage(span) {
      const t = track;
      if (state.mode !== 'live' || !t || !t.request) { toast('Skip a stage during a drive on a fun route.'); return; }
      const n = span && t.stageSpans && t.stageSpans.includes(span) ? { span } : t.stageSpans ? FunRoute.stageAhead(t.stageSpans, routeWatch.bestM || 0) : null;
      if (!n) { const line = 'No stage ahead to skip.'; toast(line); say(line, true); return; }
      // its shaping points come out of the plan; your own stops stay
      const near = (v) => { const h = Core.nearestIndex(v.lat, v.lon, t.lat, t.lon, -1); return h.index >= 0 && h.distM <= 80 ? t.dist[h.index] : null; };
      t.request = { ...t.request, via: t.request.via.filter(v => { if (!v.shaping) return true; const m = near(v); return m == null || m < n.span.startM - 50 || m > n.span.endM + 50; }) };
      t.stageSpans = t.stageSpans.filter(s => s !== n.span);
      const line = `Skipping ${n.span.name || 'this stage'}.`;
      toast(line); say(line, true);
      reroute(t);
    }
    // Round 3 (the owner's drive to work, 2026-10-30: "the drive isn't in my log"; drive_keep.js): a drive is kept as it
    // goes. Recorded frames write a checkpoint (the new rows) to IndexedDB every 15 s or 250 m, and in the app the shell
    // journals every fix since the last one on disk (ApexKit DriveJournal: 'journal' messages, apex.backlog). The car's
    // screen going, or a long stop with none, ends and saves the drive (EndWatch); one the page never ended is rebuilt at
    // the next launch and saved to the Log, said so (recoverKept). A frame never measured is never made up.
    const keep = { id: null, k: null, watch: null, seq: null, writing: Promise.resolve(), queued: false, ending: false, car: false, resume: null };
    function journalPost(msg) {
      const native = NATIVE_SHELL && window.webkit.messageHandlers.apex;
      if (native) try { native.postMessage({ cmd: 'journal', ...msg }); } catch (_) {}
    }
    function keepStart() {
      const r = keep.resume; keep.resume = null;
      keep.id = r ? r.id : `drive_${Date.now().toString(36)}`; keep.seq = r ? r.seq : null; keep.ending = false; keep.queued = false;
      keep.k = r ? r.k : ApexDriveKeep.fresh(Date.now());
      if (r) drive.rec = r.rec;                                        // a page reloaded mid-drive carries on with its own recording
      keep.watch = r && r.watch ? r.watch : new ApexDriveKeep.EndWatch(); keep.watch.carScreen(keep.car, Date.now());
      journalPost({ op: 'start', id: keep.id });
    }
    /** The drive is over: no more checkpoints. Returns its id for keepDone once it is saved (or not worth saving). */
    function keepStop() { const id = keep.id; keep.id = null; keep.watch = null; keep.queued = false; return id; }
    function keepDone(id) {
      if (!id) return;
      journalPost({ op: 'end', id });
      keep.writing = keep.writing.then(() => ApexRecording.keepRemove(id)).catch(() => {});   // after any checkpoint still being written
    }
    function keepCar(on, at) { keep.car = on; if (keep.watch) keep.watch.carScreen(on, Number.isFinite(at) ? at : Date.now()); }
    function keepMeta() {
      const c = routingCar();
      return { routeName: track && track.kind === 'route' && typeof track.name === 'string' ? track.name.trim() : '',
               road: window.ApexRoadNames && drive.rec ? ApexRoadNames.mainRoad(drive.roads, drive.rec.km * 1000) : null,
               car: c ? { label: c.label, mu: Core.carGrip(c) } : null };
    }
    /** A checkpoint now (one at a time, in order; a second ask while one is written runs once after it). */
    function keepSave() {
      if (!keep.id || !drive.rec || !drive.rec.samples) return;
      if (keep.queued) return;
      keep.queued = true;
      keep.writing = keep.writing.then(async () => {
        keep.queued = false;
        const id = keep.id, rec = drive.rec, seq = keep.seq;
        if (!id || !rec || rec.samples <= keep.k.rows - 1) return;
        const cp = ApexDriveKeep.checkpoint(id, rec, keep.k, { ...keepMeta(), watch: keep.watch ? keep.watch.state() : null }, seq, Date.now());
        await ApexRecording.keepPut(cp.head, cp.chunk);
        if (keep.id !== id) return;
        keep.k = cp.next;
        if (seq != null) journalPost({ op: 'durable', id, seq });     // the shell's journal lets go of what is kept
      }).catch((e) => console.error('keep drive', e));
    }
    /** Each frame of the drive (recorded or in a privacy zone, where only its time and speed count): checkpoint, or end. */
    function keepFrame(fr) {
      if (!keep.id || !drive.rec || keep.ending) return;
      if (Number.isFinite(fr.seq)) keep.seq = fr.seq;
      const at = Number.isFinite(fr.at) ? fr.at : Number.isFinite(fr.t) ? fr.t : Date.now();
      const end = keep.watch.feed(fr.has_fix ? fr : { speed_mps: null }, drive.rec.samples, at);
      if (end) {
        keep.ending = true;
        Promise.resolve().then(() => {                                 // after this frame's own work
          if (!driveActive || !drive.rec) return;
          drive.rec.truncate(end.rows);                                // the drive as it stood when the car last drove
          leaveDrive(true, end.why);
        });
        return;
      }
      if (ApexDriveKeep.due(keep.k, drive.rec, Date.now())) keepSave();
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') keepSave(); });
    window.addEventListener('pagehide', () => keepSave());
    // What the shell journaled (null on the web, or a shell that never answers)
    let journalsWaiter = null;
    function nativeJournals() {
      if (!NATIVE_SHELL) return Promise.resolve(null);
      return new Promise((resolve) => {
        const timer = setTimeout(() => { journalsWaiter = null; resolve(null); }, 3000);
        journalsWaiter = (msg) => { clearTimeout(timer); journalsWaiter = null; resolve(msg); };
        journalPost({ op: 'list' });
      });
    }
    async function recoverKept() {
      const [kept, native] = await Promise.all([ApexRecording.keepAll(), nativeJournals()]);
      const journals = native && Array.isArray(native.list) ? native.list : [];
      if (native && typeof native.car === 'boolean') keepCar(native.car);
      const ids = new Set([...kept.map((k) => k.id), ...journals.map((j) => j && j.id).filter((id) => typeof id === 'string')]);
      let saved = 0, lastName = null;
      for (const id of ids) {
        const k = kept.find((x) => x.id === id) || { head: null, chunks: [] }, j = journals.find((x) => x && x.id === id);
        const { rec, watch, end } = ApexDriveKeep.rebuild(k.head, k.chunks, j && Array.isArray(j.frames) ? j.frames : []);
        if (j && j.active && !end) {
          // the page was reloaded (the phone ended it in the background) in the middle of a drive the shell is still on
          if (driveActive) continue;
          const n = k.head ? k.head.chunks : 0, fs = Array.isArray(j.frames) ? j.frames : [];
          keep.resume = { id, rec, watch, seq: fs.length ? fs[fs.length - 1].seq : (k.head ? k.head.seq : null),
                          k: { at: Date.now(), rows: k.head ? Math.min(k.head.state.n, rec.samples) : 0, dist: k.head ? k.head.state.dist : 0, n } };
          enterDrive();
          keep.resume = null;                                          // taken by keepStart (or a drive was already starting)
          toast('Still recording the drive you were on.');
          continue;
        }
        if (ApexDriveKeep.keepable(rec)) {
          try {
            const meta = (k.head && k.head.meta) || {};
            const job = driveJob(rec, (when) => meta.routeName || meta.road || `Drive ${when.toLocaleDateString()} ${ApexFormat.clock12(when.getHours(), when.getMinutes())}`);
            const extra = { ended: j && j.active ? end.why : 'recovered' };   // (one the shell is still on was over while the page slept)
            if (meta.car && Number.isFinite(meta.car.mu)) extra.car = meta.car;
            // parsed, scored and saved in the analysis worker, as End does it (F-04): the launch is not held by a drive
            const { rows: _, ...recState } = rec.snapshot(rec.samples);
            await ApexAnalysis.job('save', { state: recState, rows: rec.rows, fileName: job.fileName, meta: job.meta, extra });
            saved++; lastName = job.meta.name;
          } catch (e) { console.error('recover drive', e); continue; }   // kept for the next launch
        }
        journalPost({ op: 'end', id });
        await ApexRecording.keepRemove(id).catch(() => {});
      }
      if (saved) {
        await refreshSavedDrives();
        toast(saved === 1 ? `${lastName || 'Your last drive'} was saved to the Log. The app closed before it was ended.` : `${saved} drives were saved to the Log. The app closed before they were ended.`, { ms: 8000 });
      }
    }
    // Privacy zones (privacy_zones.js, IDEAS Z-02): inside one the drive keeps no samples, road data stops, convoys get no
    // position. A drive that enters one stops sharing road data for the rest of that drive (the stretch before stays private too).
    function recordFrame(fr) {
      if (!inPrivacyZone(fr.lat, fr.lon)) { drive.rec.add(fr); keepFrame(fr); return true; }
      drive.rec.pause();
      keepFrame(fr);
      if (drive.live) { drive.live.finish().catch(() => {}); drive.live = null; drive.share = 'zone'; }
      return false;
    }
    window.apex = {
      live(frame) {
        if (frame) feedPower({ thermal: frame.thermal, lowPowerMode: frame.low_power_mode });
        if (frame && NATIVE_SHELL && typeof frame.location_off === 'boolean') setLocOff(frame.location_off);
        if (frame && !frame.has_fix && drive.native && drive.rec) keepFrame(frame);   // Round 3: a stop with no sky (a garage) still ends it
        if (!frame || !frame.has_fix || !Number.isFinite(frame.lat) || !Number.isFinite(frame.lon)) return;
        feedMotion(frame.speed_mps);
        state.lastPosition = { lat: frame.lat, lon: frame.lon }; state.lastPositionAt = performance.now();
        state.lastMotion = { heading: Number.isFinite(frame.course_deg) ? frame.course_deg : null, speedMps: Number.isFinite(frame.speed_mps) ? frame.speed_mps : null };
        if (NATIVE_SHELL) feedAmbient(inPrivacyZone(frame.lat, frame.lon) ? { has_fix: false } : frame);   // ends the trip; its last km stays here
        if (NATIVE_SHELL && !driveActive) { showIdleFix(frame); return; }
        feedReported(frame); feedReaction(frame); feedCrash(frame);
        state.live = frame; state.liveAt = performance.now();
        if (drive.native && drive.rec && !(Number.isFinite(frame.seq) && keep.seq != null && frame.seq <= keep.seq)) {   // (taken in a backlog)
          drive.frames++; recordFrame(frame); feedLive(); noteRoads(); noteRest(frame); noteBrakes(frame); noteWet(); noteFlow(); feedStage(); feedCoach(); feedTrack(frame);
          if (window.ApexBattery) drive.battery = ApexBattery.feed(drive.battery, frame.battery, frame.charging === true, Date.now());
          const gps = Number.isFinite(frame.accuracy_m) && frame.accuracy_m > ApexSensors.MAX_ACCURACY_M ? 'weak' : 'on';
          if (drive.status.gps !== gps) drive.status.gps = gps;
          const cal = typeof frame.calibration === 'string' ? frame.calibration : null;
          // The mount guide's tick: say so when calibration locks after the driver saw "Calibrating"
          if (cal === 'locked' && (drive.status.calibration === 'default' || drive.status.calibration === 'awaitingPull')) {
            drive.status.mountSetUntil = performance.now() + 6000;   // U-74: said in the status line for 6 s, not over the map
            health.bump('calib_locked'); if (drive.startedAt) health.bump('calib_lock_s', (performance.now() - drive.startedAt) / 1000);
          }
          drive.status.calibration = cal;
          paintDriveStat();
        }
        const entering = state.mode !== 'live';
        if (entering) { setPlaying(false); setMode('live'); paintModeSwitch(); resumeFollow(); }
        refreshAutoNight();
        render(entering);
      },
      // Round 3: the fixes the shell journaled while this page was suspended (the phone locked, the app in the background),
      // oldest first. Recorded only: the moment for their notes and the map has passed. True once taken.
      backlog(frames) {
        if (!Array.isArray(frames)) return false;
        for (const f of frames) {
          if (!drive.native || !drive.rec || keep.ending) break;
          if (!f || !f.has_fix || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
          if (Number.isFinite(f.seq) && keep.seq != null && f.seq <= keep.seq) continue;
          drive.frames++; recordFrame(f);
        }
        if (drive.rec && !keep.ending) { noteRoads(); keepSave(); }
        return true;
      },
      onNative(msg) {
        if (msg && msg.type === 'journals') { if (journalsWaiter) journalsWaiter(msg); return; }
        if (msg && msg.type === 'driveCam') { driveCamSaid(msg.state); return; }
        if (msg && msg.type === 'carOffline') { carOfflineBytes = Number.isFinite(msg.bytes) ? msg.bytes : null; if (typeof renderOffline === 'function') renderOffline().catch(() => {}); return; }
        if (msg && msg.type === 'lifecycle') { if (driveActive) keepSave(); return; }   // going to the background: kept now
        if (msg && (msg.type === 'placeSuggestions' || msg.type === 'placeResolved' || msg.type === 'trafficProbe')) { nativePlaceReply(msg); return; }
        if (msg && msg.type === 'nudge') { nudgeAnswered(!!msg.granted); return; }
        if (msg && msg.type === 'push') { pushAnswered(!!msg.granted); return; }
        if (msg && msg.type === 'pushToken') { pushTokenIn(msg); return; }
        if (msg && msg.type === 'context') { if (window.ApexIosContext) ApexIosContext.receive(msg); return; }   // My free time / This album
        if (msg && msg.type === 'recordingSaved') toast(`Saved ${msg.segments} road segments to ${msg.file}.`);
        // App sign-in finished in the native shell: keep the session token and redraw whatever shows account state.
        // the shell keeps the token in the Keychain and says signedIn (IDEAS Z-10); an older shell hands the token over
        // Redrawn in place (the owner, 2026-10-29: no page reloads): the account and Garage, and drive sharing asks again.
        // the person stopped using their Apple ID with Vetta (iPhone Settings): the shell ended the session; redraw signed out
        if (msg && msg.type === 'session' && msg.signedIn === false) { ApexSync.setSession(null); clearCarry(); clearCrowd(); toast('Signed out: Apple sign-in was turned off for Vetta.'); renderAccount(); return; }
        if (msg && msg.type === 'session' && (msg.token || msg.signedIn)) { ApexSync.setSession(msg.token || true); toast('Signed in.'); ambient.checkedAt = -Infinity; renderAccount(); checkAmbientAllowed(); }
        if (msg && msg.type === 'promptStyle') { if (promptStyleWaiter) promptStyleWaiter(msg.style || 'normal'); return; }
        if (msg && msg.type === 'link' && msg.params) { openAppLink(msg.params); return; }
        if (msg && msg.type === 'gpx' && typeof msg.text === 'string') { openGpx(msg.text, msg.name); return; }
        if (msg && msg.type === 'carplay') { carAction(msg); return; }
        // The phone joined CarPlay (IDEAS C-05): offer the drive, never start recording unasked.
        if (msg && msg.type === 'car' && !driveActive && state.mode !== 'live') { toast('CarPlay connected.', { label: 'Start drive', ms: 10000, onClick: startDrive }); carOfferUntil = $('toast')._holdUntil; return; }
        if (msg && msg.type === 'signInFailed' && msg.reason !== 'cancelled') toast('Couldn\'t sign in. Check signal and try again.');
      }
    };
    let idleSnapped = false;
    function showIdleFix(frame) {
      refreshAutoNight();
      if (replayOn || state.mode === 'live') return;   // a replay or preview owns the map
      setVehicle({ lat: frame.lat, lon: frame.lon, bearing: Number.isFinite(frame.course_deg) ? frame.course_deg : state.bearing,
                   vMps: Number.isFinite(frame.speed_mps) ? frame.speed_mps : 0, onTrack: false, latG: null, lonG: 0, rough: 0 }, !idleSnapped);
      idleSnapped = true;
    }
    setInterval(() => {
      // A native drive keeps going through a GPS gap (tunnel): say so instead of dropping back to the replay.
      if (drive.native && performance.now() - state.liveAt > 5000) {
        if (drive.status && drive.status.gps !== 'waiting' && !locDenied) { drive.status.gps = 'waiting'; paintDriveStat(); }
        return;
      }
      if (state.mode === 'live' && !drive.sensors && performance.now() - state.liveAt > 5000) {
        if (track && track.kind === 'horizon') track = null;
        state.live = null; setMode(track && track.kind === 'route' ? 'sim' : 'replay'); paintModeSwitch(); toast('GPS lost. Back to the replay.');
        refreshAutoNight();
      }
    }, 1000);

    // =======================================================================
    // 12. BOOT
    // =======================================================================
    paintSwitches();
    drawPuck();
    renderHighlights(); renderNearbyHighlights();
    renderAccount();
    async function bootDrives() {
      // a replay of one of your drives waits for it; otherwise the road memory builds in the worker while the map starts
      if (params.has('drive')) await refreshSavedDrives(params.get('drive')); else refreshSavedDrives();
      // Only a drive the URL asks for (Log → Replay, Watch a replay links); otherwise the map starts idle at your position.
      if (params.has('drive') && !drives.some(d => d.id === params.get('drive'))) await loadDemos();
      const first = params.has('drive') ? drives.find(d => d.id === params.get('drive')) : null;
      if (first) {
        const at = params.has('at') ? parseFloat(params.get('at')) || 0 : 0;
        if (!replayOn) activate(first, at * first.dist[first.dist.length - 1]);
        replayOn = replayOn || ['drive', 'play', 'at'].some(k => params.has(k));
        booting = false; paintIdle();
        if (params.get('play') === '1') replayWhenReady(first);       // U-128: once the map has the drive's start
      } else {
        // After a reload in the same session (a lost map): the planned route returns, quietly (booting: no preview), without
        // waiting for the map, which draws it whenever it finishes loading.
        await restorePlanned().catch(() => {});
        booting = false; paintIdle();
      }
      if (params.get('book') === '1' || params.get('view') === 'route' || params.get('view') === 'drives') openPlan(true);
      if (VIEW_TITLES[params.get('view')] || PEOPLE_SIDES[params.get('view')] || params.get('view') === 'setup') openSheet(params.get('view'));
      if (params.get('go') === 'drive') driveFromLink();
      else if (params.get('go')) spokenLink(params.get('go'), params.get('q'));   // Siri from a cold start: a place, a loop
      if (/^[A-Za-z0-9_-]{16}$/.test(params.get('roadbook') || '')) openRoadbookLink(params.get('roadbook'));   // ?roadbook=: a roadbook's link
      roadFromLocation(location.search);                               // DA-4: ?road= (the app), #road= (the website)
      if (params.get('again')) driveAgain(params.get('again'));      // panel D-1: Drive it again from a Log page opened on its own   // the app opened from apexnav://open?go=drive (IDEAS C-05)
      recoverKept().catch((e) => console.error('recover drives', e));   // Round 3: a drive never ended goes to the Log
    }
    bootDrives();
    // DA-4: a road link the page was opened with, then dropped from the address (a reload doesn't plan it again)
    function roadFromLocation(search) {
      const road = window.ApexRoadLink ? ApexRoadLink.fromLocation(search, location.hash) : null;
      if (!road) return;
      if (/road=/.test(location.hash)) try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) {}
      openRoadLink(road);
    }
    window.addEventListener('hashchange', () => roadFromLocation(''));   // a second road link into an open page
    // F-15: the Log's frame loads while the map is idle after launch (not in a drive or a hidden page: then its first open loads it)
    setTimeout(() => idle(prewarmLog), 5000);
    // F-03: the social modules once the launch is over; a link that needs them, or People, asks for them at once
    if (['convoy', 'crew', 'invite', 'add', 'roadbook'].some((k) => params.has(k))) needSocial();
    else { let asked = false; const go = () => { if (!asked) { asked = true; idle(needSocial); } }; map.once('idle', () => setTimeout(go, 300)); setTimeout(go, 6000); }
    // the route-context providers (web/lazy.js 'ctx') likewise, so the first plan finds them in; a plan before then loads them
    { let warm = false; const goCtx = () => { if (!warm) { warm = true; idle(needCtx); } }; map.once('idle', () => setTimeout(goCtx, 600)); setTimeout(goCtx, 6500); }
    if (document.fonts) document.fonts.ready.then(() => render(true));
    // Native speed (big bet #10): the cover lifts on the first frames of the built cockpit, not when the map's first tile has
    // come in over the network (up to 3 s later on a cold start). The map waits on its own paper until that tile draws (U-68,
    // the 'load' handler), as Apple Maps shows its grid: the deck, Where to? and the tab bar are there to use at once.
    requestAnimationFrame(() => requestAnimationFrame(() => ApexBoot.done()));
  })();

  // The website's offline shell (web/sw.js, IDEAS A-03). Websites only: the app serves these pages from apexnav:// itself.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && location.hostname !== '127.0.0.1') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
