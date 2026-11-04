// Route context: the crowd (builder E). What our members' phones measured and how they drive each road, laid on a
// candidate route's 25 m samples, plus the driver's own taste. Source: GET /api/roads (members only; the open-road and
// two-driver rules apply on the server, backend/src/roads.ts), matched to OSM ways by Valhalla trace_attributes and
// Overpass way geometry (the existing "measured roads" path, contributor.js). Licence: our members' data (no attribution);
// OSM geometry ODbL (attributed in About > Sources). Cadence: live per request; cached per way for CACHE_MS on the phone.
//
// Channels (Float32Array per sample; NaN = unknown, never 0 for unknown):
//   crowd_rough_g   g rms   members' merged pavement roughness (passes that disagree, contributor.AGREE, are NaN)
//   crowd_bank_deg  deg     merged camber relative to the turn: + banked into it, - off-camber (disputed = NaN)
//   crowd_curv      1/m     the driven paths' mean curvature (+ left), IDEAS Q-04
//   crowd_conf      0..3    how sure: 1 one pass, 2 two to four, 3 five or more (a level, never a count)
//   crowd_flow      0..1    flow confidence: how smoothly members drive it at speed. Per bin fl (speed steadiness over ~40 m,
//                           a ratio holding no speed) x (1 - share of passes that braked hard with no corner ahead), shrunk
//                           toward 0.5 under FLOW_FULL_PASSES passes. 1 = they flow through it, 0 = stop-start
//   loved           0..1    loved-roads score: the most of (members coming back to it on a second recorded drive, level
//                           1..3 -> 0.4/0.7/1.0), (your crews' shared routes and stages: 0.8 on them), (your own "Which road
//                           was better?" rating of the road by name, Elo 1500..1650 -> 0..1), (roads you drove on two or
//                           more of your drives: 0.6). Each part known only where it could be checked; all unknown = NaN
//   taste           points  fun points from your taste (web/taste.js fit of your answers) over 2 km windows, -8..+8;
//                           NaN under taste.MIN_VOTES answers
//   crowd_busy      ratio   how busy members find it in the hour bucket you'd be there (1 = its average, 2 = twice):
//                           ONLY with the quiet_hours flag on (the owner's open Quiet hours decision; default off), else NaN
// Spans: loved (>= 0.6 for 300 m, label the road's name), flowing (crowd_flow >= 0.75 for 500 m), stop_start (crowd_flow
//   <= 0.3 for 200 m), busy (crowd_busy >= 1.5 for 500 m). Points: none.
// Pure parts exported for tests (tests/test_route_ctx_crowd.py); fetch is the network shell.
(function (root) {
  'use strict';
  const U = (typeof module !== 'undefined' && module.exports ? require('./ctx_util.js') : root.ApexRouteCtxUtil).E;   // E's helpers (ctx_util.js)
  const CH = ['crowd_rough_g', 'crowd_bank_deg', 'crowd_curv', 'crowd_conf', 'crowd_flow', 'loved', 'taste', 'crowd_busy'];
  const FLOW_FULL_PASSES = 3, MAX_WAYS = 150, TASTE_WIN = 80;          // 80 x 25 m = 2 km windows
  const AGREE = { camber_deg: 1.5, rough_g: 0.05 };                    // as contributor.js
  const LOVE_LEVEL = [NaN, 0.4, 0.7, 1.0], CREW_LOVE = 0.8, MINE_AGAIN = 0.6, ELO0 = 1500, ELO_SPAN = 150;
  const finite = U.finite;

  /** Confidence level from passes, as the server's confLevel. */
  const confLevel = (n) => (n >= 5 ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0);
  /** 'differ' when passes disagree beyond tol (contributor.agreement). */
  const differs = (passes, sd, tol) => passes >= 2 && finite(sd) && sd > tol;

  /** Flow confidence of one merged bin: fl x (1 - hb), shrunk toward 0.5 under FLOW_FULL_PASSES passes; NaN unmeasured. */
  function flowConfidence(fl, hb, fn) {
    if (!(fn >= 1) || !finite(fl)) return NaN;
    const base = fl * (1 - (finite(hb) ? hb : 0));
    return 0.5 + (base - 0.5) * Math.min(1, fn / FLOW_FULL_PASSES);
  }

  /** The busy-time bucket (0..11) of an epoch ms in local time: weekday 0..5 / weekend 6..11 by 4-hour block. */
  function bucketOf(ms) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return null;
    return (d.getDay() === 0 || d.getDay() === 6 ? 6 : 0) + Math.floor(d.getHours() / 4);
  }
  /** hr (12 shares) at that time, as a ratio to the road's average bucket; NaN without hr. */
  function busyAt(hr, ms) {
    const b = bucketOf(ms);
    return Array.isArray(hr) && hr.length === 12 && b !== null && finite(hr[b]) ? hr[b] * 12 : NaN;
  }

  /**
   * Places a coarse (25 m) corridor's matched samples on their OSM ways, as contributor.locate does for 5 m drives but for
   * runs of 3+ samples: [{ way, dir, pts: [{ i, bin }] }]. deps: { project, cumulative, SKIP } from contributor.js.
   */
  function locateCoarse(t, match, ways, deps) {
    const runs = [], out = [];
    for (let i = 0; i < t.lat.length; i++) {
      const m = match[i];
      if (!m || m.way == null || (deps.SKIP && deps.SKIP.has(m.cls))) continue;
      const last = runs[runs.length - 1];
      if (last && last.way === m.way && last.end === i - 1) { last.end = i; last.idx.push(i); } else runs.push({ way: m.way, end: i, idx: [i] });
    }
    for (const run of runs) {
      const poly = ways[run.way];
      if (!poly || poly.length < 2 || run.idx.length < 3) continue;
      const cum = deps.cumulative(poly);
      const pts = run.idx.map((i) => ({ i, ...deps.project(poly, t.lat[i], t.lon[i], cum) })).filter((p) => p.d <= 25);
      if (pts.length < 3) continue;
      const fwd = pts[pts.length - 1].off - pts[0].off;
      if (Math.abs(fwd) < 30) continue;
      out.push({ way: run.way, dir: fwd > 0 ? 0 : 1, pts: pts.map((p) => ({ i: p.i, bin: Math.floor(p.off / 5) })) });
    }
    return out;
  }

  /**
   * The crowd channels for one corridor from located runs and the /api/roads answer (`roads`: { way: { dir: {...} } }).
   * Samples on a located way but with no bin answered are known-unmeasured only for `measured` (0); everything else NaN.
   * ctx: { etaAt, quietHours, crewGrid (Map/Set of cells), againGrid, votes ({ r: { name: elo } }), names (per sample) }.
   */
  function channelsFrom(n, runs, roads, ctx = {}) {
    const ch = Object.fromEntries(CH.map((k) => [k, U.nan(n)]));
    const located = new Uint8Array(n), agLevel = new Float32Array(n).fill(NaN);
    for (const run of runs) {
      const d = roads && roads[run.way] && roads[run.way][run.dir];
      const idx = d ? new Map(d.i.map((b, j) => [b, j])) : null;
      for (const p of run.pts) {
        located[p.i] = 1;
        if (!d) continue;
        agLevel[p.i] = finite(d.ag) ? d.ag : 0;                       // a shown road nobody came back to: known 0
        const j = idx.get(p.bin);
        if (j == null) continue;
        const at = (a) => (a && a[j] != null ? a[j] : null);
        if (finite(at(d.rough)) && !differs(d.n[j], at(d.rsd), AGREE.rough_g)) ch.crowd_rough_g[p.i] = d.rough[j];
        if (finite(at(d.cam)) && !differs(at(d.cn) ?? d.n[j], at(d.csd), AGREE.camber_deg)) ch.crowd_bank_deg[p.i] = d.cam[j];
        if (finite(at(d.k)) && at(d.kn) > 0) ch.crowd_curv[p.i] = d.k[j];
        ch.crowd_conf[p.i] = confLevel(d.n[j]);
        ch.crowd_flow[p.i] = flowConfidence(at(d.fl), at(d.hb), at(d.fn));
        if (ctx.quietHours && ctx.etaAt) ch.crowd_busy[p.i] = busyAt(d.hr, ctx.etaAt[p.i]);
      }
    }
    for (let i = 0; i < n; i++) {
      const parts = [];
      if (finite(agLevel[i])) parts.push(agLevel[i] ? LOVE_LEVEL[agLevel[i]] : 0);
      if (ctx.crewGrid && ctx.lat) parts.push(U.lookup(ctx.crewGrid, ctx.lat[i], ctx.lon[i]) !== undefined ? CREW_LOVE : 0);
      if (ctx.againGrid && ctx.lat) parts.push(U.lookup(ctx.againGrid, ctx.lat[i], ctx.lon[i]) !== undefined ? MINE_AGAIN : 0);
      const name = ctx.names && ctx.names[i], elo = name && ctx.votes && ctx.votes.r ? ctx.votes.r[String(name).trim().toLowerCase()] : undefined;
      if (finite(elo)) parts.push(Math.max(0, Math.min(1, (elo - ELO0) / ELO_SPAN)));
      if (parts.length) ch.loved[i] = Math.max(...parts);
    }
    return { channels: ch, located: located.reduce((a, b) => a + b, 0) / (n || 1) };
  }

  /** Cells of roads you drove on two or more of your drives (tracks: [{ lat[], lon[] }]), for loved's own part. */
  function againGrid(tracks) {
    const seen = new Map(), out = new Map();
    (tracks || []).forEach((t, k) => {
      const mine = U.paint(new Map(), (t.lat || []).map((la, i) => [la, t.lon[i]]).filter((_, i) => i % 4 === 0), 1);
      for (const c of mine.keys()) { const was = seen.get(c); if (was !== undefined && was !== k) out.set(c, 1); else seen.set(c, k); }
    });
    return out;
  }
  /** A cell grid from crew-shared lines ([{ lat[], lon[] }] or [[lon, lat]] lists, prefer.js shapes). */
  function lineGrid(lines) {
    const m = new Map();
    for (const ln of lines || []) {
      if (Array.isArray(ln)) U.paint(m, ln.map((p) => [p[1], p[0]]), 1);
      else if (ln && ln.lat) U.paint(m, Array.from(ln.lat, (la, i) => [la, ln.lon[i]]), 1);
    }
    return m;
  }

  /** taste channel: TASTE.bonus over 2 km windows of the corridor (deps: Core, Taste); all NaN with no fit or no Core. */
  function tasteChannel(t, fit, deps) {
    const n = t.lat.length, out = U.nan(n);
    if (!fit || !deps || !deps.Core || !deps.Taste) return out;
    for (let a = 0; a < n; a += TASTE_WIN / 2) {
      const b = Math.min(n, a + TASTE_WIN);
      if (b - a < 40) break;
      let f = null;
      try { f = deps.Taste.featuresOf(deps.Core, { lat: Array.from(t.lat.subarray(a, b)), lon: Array.from(t.lon.subarray(a, b)) }, { quick: true }); } catch (_) { f = null; }
      if (!f) continue;
      const v = deps.Taste.bonus(fit, f);
      for (let i = a; i < b; i++) out[i] = finite(out[i]) ? (out[i] + v) / 2 : v;
    }
    return out;
  }

  function spansFrom(ch, distM, names) {
    const nameAt = (a, b) => { const v = names && (names[Math.floor((a + b) / 2)] || names[a]); return v || 'Members come back to it'; };
    return [
      ...U.spansWhere(ch.loved, distM, (v) => v >= 0.6, 300, 'loved', nameAt),
      ...U.spansWhere(ch.crowd_flow, distM, (v) => v >= 0.75, 500, 'flowing', 'Members drive it smoothly'),
      ...U.spansWhere(ch.crowd_flow, distM, (v) => v <= 0.3, 200, 'stop_start', 'Members stop and start here'),
      ...U.spansWhere(ch.crowd_busy, distM, (v) => v >= 1.5, 500, 'busy', 'Usually busy at this time'),
    ];
  }

  // ---- network shell -------------------------------------------------------------------------------------------------
  const cache = new Map(), CACHE_MS = 30 * 60000;                     // /api/roads answers per way, this session

  /**
   * opts: { signal, budgetMs, fetch, lookup(ids) -> /api/roads JSON | null (signed out), Contributor (contributor.js),
   *         quietHours, crewLines, myTracks, votes, taste (taste.fit result), Core, Taste, now }.
   * Never throws; a corridor with nothing to say is 'unavailable', signed out 'no-key' (members only).
   */
  async function fetchCtx(corridors, opts = {}) {
    const out = {}, C = opts.Contributor || root.ApexContributor, now = opts.now || Date.now();
    const base = (c) => ({ status: 'unavailable', channels: Object.fromEntries(CH.map((k) => [k, U.nan(c.lat.length)])), spans: [], points: [] });
    for (const c of corridors) out[c.id] = base(c);
    const crewGrid = opts.crewLines ? lineGrid(opts.crewLines) : null;
    const mine = opts.myTracks ? againGrid(opts.myTracks) : null;
    const local = { crewGrid, againGrid: mine, votes: opts.votes || null, quietHours: !!opts.quietHours };
    // taste and the phone's own parts need no network: filled even when the server can't answer
    let closed = false;                                                // past the budget: the answer already went back as it was
    const fill = (c, runs, roads, names) => {
      if (closed) return;
      const r = channelsFrom(c.lat.length, runs, roads, { ...local, lat: c.lat, lon: c.lon, etaAt: c.etaAt, names });
      r.channels.taste = tasteChannel(c, opts.taste, { Core: opts.Core || root.ApexCore, Taste: opts.Taste || root.ApexTaste });
      const any = CH.some((k) => r.channels[k].some(finite));
      out[c.id] = { status: !roads ? (any ? 'partial' : (opts.lookup ? 'unavailable' : 'no-key')) : (r.located > 0.5 ? 'ok' : 'partial'),
        ...(roads ? {} : { note: opts.lookup ? 'Members’ road data couldn’t be loaded' : 'Members’ road data needs signing in' }),
        channels: r.channels, spans: spansFrom(r.channels, c.distM, names), points: [] };
    };
    const work = (async () => {
      if (!C || !opts.lookup) { for (const c of corridors) fill(c, [], null, null); return; }
      const matches = await Promise.all(corridors.map((c) => C.matchDrive({ lat: Array.from(c.lat), lon: Array.from(c.lon) }, opts.fetch).catch(() => null)));
      const ids = [...new Set(matches.flat().filter((m) => m && m.way != null).map((m) => m.way))].slice(0, MAX_WAYS);
      const fresh = ids.filter((id) => !(cache.has(id) && now - cache.get(id).at < CACHE_MS));
      let ways = {}, roads = {};
      try {
        const parts = [];
        for (let s = 0; s < fresh.length; s += 50) parts.push(await opts.lookup(fresh.slice(s, s + 50)));
        if (parts.some((p) => !p)) roads = null;
        else { for (const p of parts) Object.assign(roads, p); for (const id of fresh) cache.set(id, { at: now, road: roads[id] || null }); }
        if (roads) for (const id of ids) if (!fresh.includes(id)) { const r = cache.get(id).road; if (r) roads[id] = r; }
        ways = ids.length ? await C.fetchWays(ids, opts.fetch) : {};
      } catch (_) { roads = null; }
      corridors.forEach((c, k) => {
        const m = matches[k] || [];
        const runs = m.length ? locateCoarse(c, m, ways, { project: C.project, cumulative: C.cumulative, SKIP: C.SKIP_CLASSES }) : [];
        fill(c, runs, roads, m.map((x) => (x && x.name) || null));
      });
    })().catch(() => { for (const c of corridors) fill(c, [], null, null); });
    await U.within(work, opts.budgetMs || provider.budgetMs, opts.signal);
    closed = true;
    return out;
  }

  const provider = { id: 'crowd', version: 1, channels: CH, needs: { network: true }, budgetMs: 9000, fetch: fetchCtx };
  U.registry().register(provider);

  const api = { provider, CH, flowConfidence, bucketOf, busyAt, locateCoarse, channelsFrom, againGrid, lineGrid, tasteChannel, spansFrom, confLevel, FLOW_FULL_PASSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteCrowd = api;
})(typeof window !== 'undefined' ? window : globalThis);
