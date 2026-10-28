// Phone-side road-data contributor (docs/BACKEND.md sections 3-4). Turns a profiled drive into per-road bin summaries.
// What leaves the phone: OSM way id, direction, bin index, and four road numbers per 5 m bin. Never coordinates, speeds or times.
// The pure part (buildContributions) is deterministic and unit-tested; matchDrive/fetchWays/contributeDrive are the thin network shell.
(function (root) {
  const SMOOTH_G = 0.12, ROUGH_G = 0.30, MAX_LOOKUP_WAYS = 150;   // roughness g rms: smooth at or under, broken at or over
  const BIN_M = 5, MIN_BINS = 20, MAX_BINS = 2000, MAX_OFF_ROAD_M = 25, MAX_AGE_DAYS = 13;
  const SKIP_CLASSES = new Set(['residential', 'service_other', 'unclassified_service', 'service']);   // private-feeling roads are never contributed
  const M_LAT = 110540;

  /** Arc-length offset (m) of a point along a polyline [[lat,lon],...], plus its distance off the line. Local flat-earth projection. */
  function project(poly, lat, lon, cum) {
    const mLon = 111320 * Math.cos(lat * Math.PI / 180);
    let best = { off: 0, d: Infinity };
    for (let i = 0; i + 1 < poly.length; i++) {
      const ax = (poly[i][1] - lon) * mLon, ay = (poly[i][0] - lat) * M_LAT, bx = (poly[i + 1][1] - lon) * mLon, by = (poly[i + 1][0] - lat) * M_LAT;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best.d) best = { d, off: cum[i] + t * Math.sqrt(L2) };
    }
    return best;
  }
  function cumulative(poly) {
    const cum = [0];
    for (let i = 1; i < poly.length; i++) {
      const mLon = 111320 * Math.cos(poly[i][0] * Math.PI / 180);
      cum.push(cum[i - 1] + Math.hypot((poly[i][1] - poly[i - 1][1]) * mLon, (poly[i][0] - poly[i - 1][0]) * M_LAT));
    }
    return cum;
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * drive: { lat[], lon[], camber[] (deg or null), rough[], crest[], kappa[] } at 5 m spacing
   * match: per-sample { way: number|null, cls: string|null } (null = unmatched)
   * ways:  { [wayId]: [[lat, lon], ...] } OSM geometry, bins count from the way's first node
   * Returns contributions in the /api/contribute shape. Samples within trimM of either end are dropped (hides where a trip starts and ends).
   */
  function buildContributions({ drive, match, ways, drivenOn, driveId, trimM = 1000 }) {
    const trim = Math.round(trimM / BIN_M), out = [], best = new Map();
    for (const run of locate({ drive, match, ways, from: trim, to: drive.lat.length - trim })) {   // keep the longest run per (way, direction)
      const byBin = new Map();
      for (const p of run.pts) (byBin.get(p.bin) ?? byBin.set(p.bin, []).get(p.bin)).push(p.i);
      const bins = [];
      for (const [b, ids] of [...byBin].sort((x, y) => x[0] - y[0])) {
        const rough = ids.map((i) => drive.rough[i]).filter(finite);
        if (!rough.length) continue;                                   // roughness unknown: leave the bin out rather than invent it
        const cam = ids.map((i) => drive.camber && drive.camber[i]).filter((v) => finite(v) && Math.abs(v) <= 15);
        const crest = ids.map((i) => drive.crest && drive.crest[i]).filter(finite);
        const k = ids.map((i) => drive.kappa && drive.kappa[i]).filter((v) => finite(v) && Math.abs(v) <= 0.2);
        bins.push({ i: b, cam: cam.length ? +mean(cam).toFixed(2) : null, rough: +Math.min(1.5, mean(rough)).toFixed(3),
                    // crest: the phone's signed vertical g (- = going light); the server keeps the peak unweighting, 0..3 g
                    crest: crest.length ? +Math.min(3, Math.max(0, -Math.min(...crest))).toFixed(3) : null, k: k.length ? +mean(k).toFixed(5) : null });
      }
      if (bins.length < MIN_BINS) continue;
      const span = bins[bins.length - 1].i - bins[0].i + 1;
      if (bins.length / span < 0.6) continue;                          // scattered, not a run (5 m samples on 5 m bins can skip a bin now and then: about 75% is normal worst case)
      const key = `${run.way}|${run.dir}`;
      if (!best.has(key) || best.get(key).bins.length < bins.length) best.set(key, { way_id: run.way, dir: run.dir, driven_on: drivenOn, drive_id: driveId, bins: bins.slice(0, MAX_BINS) });
    }
    return [...best.values()];
  }

  /**
   * Places each matched sample on its OSM way: runs of consecutive samples on one way, with the direction of travel along the way's own
   * node order and each sample's bin index (5 m of arc length from the way's first node). Skips private-feeling classes, runs shorter than
   * 20 samples, runs that do not follow the way, and ways without geometry. Shared by contributing and by looking up measured data.
   */
  function locate({ drive, match, ways, from = 0, to = drive.lat.length }) {
    const runs = [], out = [];
    for (let i = from; i < to; i++) {
      const m = match[i];
      if (!m || m.way == null || SKIP_CLASSES.has(m.cls)) continue;
      const last = runs[runs.length - 1];
      if (last && last.way === m.way && last.end === i - 1) { last.end = i; last.idx.push(i); } else runs.push({ way: m.way, end: i, idx: [i] });
    }
    for (const run of runs) {
      const poly = ways[run.way];
      if (!poly || poly.length < 2 || run.idx.length < MIN_BINS) continue;
      const cum = cumulative(poly);
      const pts = run.idx.map((i) => ({ i, ...project(poly, drive.lat[i], drive.lon[i], cum) }));
      if (pts.filter((p) => p.d > MAX_OFF_ROAD_M).length > pts.length * 0.1) continue;          // match did not really follow this way
      const fwd = pts[pts.length - 1].off - pts[0].off;
      if (Math.abs(fwd) < MIN_BINS * BIN_M * 0.5) continue;
      out.push({ way: run.way, dir: fwd > 0 ? 0 : 1, pts: pts.filter((p) => p.d <= MAX_OFF_ROAD_M).map((p) => ({ i: p.i, bin: Math.floor(p.off / BIN_M) })) });
    }
    return out;
  }

  // ---- network shell -------------------------------------------------------------------------------------------------------
  const VALHALLA = 'https://valhalla1.openstreetmap.de', OVERPASS = 'https://overpass-api.de/api/interpreter';

  /** Snaps the drive to the road graph with Valhalla trace_attributes (chunks of 2,500 points). Returns the per-sample match array. */
  async function matchDrive(drive, fetchFn = fetch) {
    const n = drive.lat.length, out = new Array(n).fill(null), CH = 2500;
    for (let s = 0; s < n; s += CH) {
      const e = Math.min(n, s + CH + 20);                              // small overlap so edges continue across chunks
      const shape = []; for (let i = s; i < e; i++) shape.push({ lat: drive.lat[i], lon: drive.lon[i] });
      if (shape.length < 2) continue;
      const r = await fetchFn(`${VALHALLA}/trace_attributes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        shape, costing: 'auto', shape_match: 'map_snap', filters: { attributes: ['edge.way_id', 'edge.road_class', 'matched.edge_index', 'matched.type'], action: 'include' } }) });
      if (!r.ok) throw new Error(`map matching failed (${r.status})`);
      const j = await r.json();
      (j.matched_points || []).forEach((m, k) => {
        if (s + k >= Math.min(n, s + CH) || m.type === 'unmatched' || m.edge_index == null) return;
        const ed = j.edges[m.edge_index];
        if (ed && ed.way_id != null) out[s + k] = { way: ed.way_id, cls: ed.road_class || null };
      });
    }
    return out;
  }

  /** OSM geometry for the given way ids, in node order (Overpass). */
  async function fetchWays(ids, fetchFn = fetch) {
    const ways = {};
    for (let s = 0; s < ids.length; s += 40) {
      const q = `[out:json][timeout:25];way(id:${ids.slice(s, s + 40).join(',')});out geom;`;
      const r = await fetchFn(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      if (!r.ok) throw new Error(`way lookup failed (${r.status})`);
      for (const el of (await r.json()).elements || []) if (el.type === 'way' && el.geometry) ways[el.id] = el.geometry.map((g) => [g.lat, g.lon]);
    }
    return ways;
  }

  /** Stable per drive so a retried upload is recognised as the same drive (server: one payout per person per road). */
  const driveIdFor = (d) => ('d_' + String(d.id || d.date || 'drive').replace(/[^A-Za-z0-9_-]/g, '_') + '_' + String(d.date || '').replace(/[^0-9]/g, '')).slice(0, 64).padEnd(8, '_');
  const ageDays = (iso, now) => (now - Date.parse(iso)) / 86400_000;
  /** True when a drive is recent enough for the server's 14-day window and has the columns we need. */
  const eligible = (d, now = Date.now()) => !!(d && d.rough && d.kappa && d.date && ageDays(d.date, now) <= MAX_AGE_DAYS && ageDays(d.date, now) >= -1);


  /**
   * Streams a drive to /api/contribute while it is being driven (owner decision: real time, no holding period).
   * Rows arrive one per 5 m. Every `chunk` rows the settled part of the drive is matched, turned into bins and posted.
   * Privacy: the first `skip` rows (about 1 km) are never sent and the last `lag` rows (about 1 km) are never sent, so where a trip starts and ends
   * stays on the phone; the server also never receives coordinates. Failures (matching, offline, server errors) keep the rows or the built
   * chunks and resend the same payloads later with backoff; only a refusal (signed out, opted out) stops it.
   */
  function createLive({ Core, post, fetch: fetchFn, driveId, drivenOn, chunk = 100, lag = 200, skip = 200, ctx = 20, retryMs = 30000, maxRetryMs = 300000, now = Date.now, onStatus }) {
    const A = { lat: [], lon: [], rough: [], camber: [], crest: [] };
    const wayCache = {}, HOLD = MIN_BINS + 5;
    let done = 0, busy = false, stopped = false, retryAt = 0, fails = 0, bins = 0, chunks = 0, error = null, pending = [];
    const status = () => { if (onStatus) onStatus({ state: stopped ? 'stopped' : error ? 'retrying' : 'on', km: bins * BIN_M / 1000, chunks, pending: pending.length, error }); };
    /**
     * Where this chunk should end so no road piece is cut too short to send (the server needs 20 bins per piece). A road that is still
     * running at the chunk's end keeps its last HOLD rows for the next chunk; a road that started inside the chunk waits whole for the next one.
     */
    function settledEnd(match, lf, lt) {
      const w = match[lt - 1] && match[lt - 1].way;
      if (w == null) return lt;
      let i = lt - 1;
      while (i > lf && match[i - 1] && match[i - 1].way === w) i--;
      return i === lf ? lt - HOLD : i;
    }
    /** final: the drive ended, so send whatever is settled (at least a short road piece) without holding rows back for a next chunk. */
    async function run(final = false) {
      if (busy || stopped || now() < retryAt) return;
      const n = A.lat.length, from = Math.max(done, skip), to = n - lag;
      if (!pending.length && to - from < (final ? MIN_BINS : chunk)) return;
      busy = true;
      try {
        if (!pending.length) {
          const lo = Math.max(0, from - ctx), hi = Math.min(n, to + ctx);
          const slice = { lat: A.lat.slice(lo, hi), lon: A.lon.slice(lo, hi), rough: A.rough.slice(lo, hi), camber: A.camber.slice(lo, hi), crest: A.crest.slice(lo, hi) };
          slice.kappa = Array.from(Core.computeCurvature(slice.lat, slice.lon).kappa);
          const match = await matchDrive(slice, fetchFn);
          const end = final ? to : lo + settledEnd(match, from - lo, to - lo);
          for (let i = 0; i < match.length; i++) if (i < from - lo || i >= end - lo) match[i] = null;     // context only helps the matcher
          const need = [...new Set(match.filter((m) => m && m.way != null).map((m) => m.way))].filter((id) => !wayCache[id]);
          if (need.length) Object.assign(wayCache, await fetchWays(need, fetchFn));
          pending = buildContributions({ drive: slice, match, ways: wayCache, drivenOn, driveId, trimM: 0 });
          done = end;
        }
        while (pending.length) {                                         // a failed post keeps the exact payload, so a resend is merged once
          const r = await post(pending[0]);
          if (r === 'stop') { stopped = true; pending = []; break; }
          if (r === 'retry') throw new Error('upload failed · will retry');
          if (r === true) { bins += pending[0].bins.length; chunks++; }
          pending.shift();
        }
        error = null; fails = 0;
      } catch (e) { error = e.message || String(e); fails++; retryAt = now() + Math.min(maxRetryMs, retryMs * 2 ** (fails - 1)); }
      finally { busy = false; status(); }
    }
    return {
      /** One 5 m row from the recorder: { lat, lon, roughness_rms, camber_deg? , crest? }. Never blocks. */
      push(row) {
        A.lat.push(row.lat); A.lon.push(row.lon);
        A.rough.push(Number.isFinite(row.roughness_rms) ? row.roughness_rms : null);
        A.camber.push(Number.isFinite(row.camber_deg) ? row.camber_deg : null);
        A.crest.push(Number.isFinite(row.crest) ? row.crest : null);
        if (pending.length || A.lat.length - Math.max(done, skip) - lag >= chunk) run();
      },
      stats: () => ({ km: bins * BIN_M / 1000, chunks, stopped, error, pending: pending.length, rows: A.lat.length }),
      /** Drive ended: the settled rest is sent, nothing after it (the last km stays private). Resolves when an in-flight chunk settles. */
      async finish() {
        for (let i = 0; i < 60; i++) {                                    // settle the in-flight chunk, then send any settled rows still waiting
          if (busy) { await new Promise((r) => setTimeout(r, 50)); continue; }
          const n = A.lat.length, rest = n - lag - Math.max(done, skip);
          if (stopped || error || (!pending.length && rest < MIN_BINS)) break;
          await run(!pending.length && rest < chunk);
        }
        return this.stats();
      },
      /** For tests and for retrying after reconnecting. */
      run,
    };
  }

  /**
   * Shares road data whenever the app is open and the phone is mounted (frames with calibration 'locked'), independent of
   * recording a drive. Frames are cut into trips, each its own createLive stream, so the first and last km of every trip stay on
   * the phone: a trip ends after stopS stopped, a gap in frames over gapS (app in the background), a jump over jumpM, or the mount
   * losing its lock. A refusal (signed out, sharing off) pauses new trips for pauseS.
   */
  function createAmbient({ makeRecorder, makeLive, now = Date.now, stopS = 180, gapS = 10, jumpM = 150, pauseS = 600, onStatus }) {
    let trip = null, doneKm = 0, trips = 0, lastT = null, lastFix = null, stoppedSince = null, pausedUntil = 0;
    const status = () => { if (onStatus) onStatus(stats()); };
    function stats() {
      const cur = trip ? trip.live.stats() : null;
      return { km: doneKm + (cur ? cur.km : 0), trips, active: !!trip, paused: now() < pausedUntil, error: cur ? cur.error : null };
    }
    function end() {
      if (!trip) return;
      const t = trip; trip = null; stoppedSince = null;
      t.live.finish().then((s) => { doneKm += s.km; if (s.stopped) pausedUntil = now() + pauseS * 1000; status(); }).catch(() => {});
    }
    const metres = (a, b) => Math.hypot((b.lat - a.lat) * M_LAT, (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
    return {
      /** One native frame (about every 0.1 s): { lat, lon, has_fix, speed_mps, calibration, roughness_rms, camber_deg, crest_vertical_g }. */
      frame(fr) {
        const t = now();
        const usable = fr && fr.has_fix && fr.calibration === 'locked' && finite(fr.lat) && finite(fr.lon);
        const gap = lastT != null && t - lastT > gapS * 1000, jump = lastFix && usable && metres(lastFix, fr) > jumpM;
        lastT = t;
        if (!usable || gap || jump) end();
        if (!usable) { lastFix = null; return; }
        lastFix = { lat: fr.lat, lon: fr.lon };
        if (!(finite(fr.speed_mps) && fr.speed_mps >= 1)) {             // stopped: no new road; a long stop ends the trip (privacy)
          if (stoppedSince == null) stoppedSince = t;
          if (trip && t - stoppedSince > stopS * 1000) { end(); status(); }
          return;
        }
        stoppedSince = null;
        if (!trip) {
          if (t < pausedUntil) return;
          trip = { rec: makeRecorder(), live: makeLive(), idx: 0 }; trips++; status();
        }
        trip.rec.add(fr);
        while (trip.idx < trip.rec.rows.length) {
          const x = trip.rec.rows[trip.idx++];
          trip.live.push({ lat: x.lat, lon: x.lon, roughness_rms: x.roughness_rms, camber_deg: x.camber_deg, crest: x.crest_vertical_g });
        }
        if (trip.live.stats().stopped) { end(); pausedUntil = t + pauseS * 1000; status(); }
      },
      /** The app is going away (or sharing was switched off): close the trip; its last km stays on the phone. */
      stop() { end(); },
      stats,
    };
  }

  /** Full pipeline for one drive. `post(contribution)` returns a Response-like or null. Returns { built, sent, skipped }. */
  async function contributeDrive(drive, post, opts = {}) {
    if (!eligible(drive, opts.now)) return { built: 0, sent: 0, skipped: 'drive is too old or lacks roughness data' };
    const match = await matchDrive(drive, opts.fetch);
    const ids = [...new Set(match.filter((m) => m && m.way != null).map((m) => m.way))];
    const ways = await fetchWays(ids, opts.fetch);
    const list = buildContributions({ drive, match, ways, drivenOn: drive.date.slice(0, 10), driveId: driveIdFor(drive), trimM: opts.trimM });
    let sent = 0;
    for (const c of list) {
      const r = await post(c);
      if (r === 'stop') break;
      if (r) sent++;
    }
    return { built: list.length, sent };
  }

  /**
   * What the crowd has measured along a planned route. Matches it, looks up /api/roads for the ways it uses, and returns coverage and averages.
   * `lookup(wayIds)` returns the /api/roads JSON (or null when signed out). Unknown stays unknown: no data means null, not zero.
   */
  // The server takes 50 ways a lookup; a long route asks in batches (up to 150 ways). Any batch signed out = null.
  async function lookupAll(ids, lookup) {
    const parts = [];
    for (let s = 0; s < ids.length; s += 50) parts.push(await lookup(ids.slice(s, s + 50)));
    return parts.some((p) => !p) ? null : Object.assign({}, ...parts);
  }
  async function measuredAlong(route, lookup, opts = {}) {
    const match = await matchDrive(route, opts.fetch);
    const ids = [...new Set(match.filter((m) => m && m.way != null).map((m) => m.way))].slice(0, MAX_LOOKUP_WAYS);
    if (!ids.length) return null;
    const [ways, roads] = await Promise.all([fetchWays(ids, opts.fetch), lookupAll(ids, lookup)]);
    if (!roads) return null;
    return summarize(locate({ drive: route, match, ways }), roads, route.lat.length);
  }
  /** Per-sample measured series along a route: { cam[], rough[], n[] } with null where no member has measured that 5 m. */
  function seriesFrom(runs, roads, total) {
    const cam = new Array(total).fill(null), rough = new Array(total).fill(null), n = new Array(total).fill(null);
    for (const run of runs) {
      const d = roads[run.way] && roads[run.way][run.dir]; if (!d) continue;
      const idx = new Map(d.i.map((b, j) => [b, j]));
      for (const p of run.pts) { const j = idx.get(p.bin); if (j == null) continue; cam[p.i] = d.cam[j]; rough[p.i] = d.rough[j]; n[p.i] = d.n[j]; }
    }
    return { cam, rough, n };
  }
  async function measuredSeries(route, lookup, opts = {}) {
    const match = await matchDrive(route, opts.fetch);
    const ids = [...new Set(match.filter((m) => m && m.way != null).map((m) => m.way))].slice(0, MAX_LOOKUP_WAYS);
    if (!ids.length) return null;
    const [ways, roads] = await Promise.all([fetchWays(ids, opts.fetch), lookupAll(ids, lookup)]);
    return roads ? seriesFrom(locate({ drive: route, match, ways }), roads, route.lat.length) : null;
  }
  function summarize(runs, roads, total) {
    let covered = 0, located = 0, passes = 0, rough = [], banked = 0, smooth = 0, broken = 0;
    for (const run of runs) {
      const d = roads[run.way] && roads[run.way][run.dir], idx = d ? new Map(d.i.map((b, j) => [b, j])) : null;
      for (const p of run.pts) {
        located++;
        const j = idx && idx.get(p.bin);
        if (j == null) continue;
        covered++; passes += d.n[j];
        if (finite(d.rough[j])) { rough.push(d.rough[j]); if (d.rough[j] <= SMOOTH_G) smooth++; else if (d.rough[j] >= ROUGH_G) broken++; }
        if (finite(d.cam[j]) && Math.abs(d.cam[j]) >= 3) banked++;
      }
    }
    return { km: total * BIN_M / 1000, coveredKm: covered * BIN_M / 1000, coverage: total ? covered / total : 0, located: located / (total || 1),
             roughness: rough.length ? mean(rough) : null, bankedKm: banked * BIN_M / 1000, avgPasses: covered ? passes / covered : null,
             smoothKm: smooth * BIN_M / 1000, roughKm: broken * BIN_M / 1000 };
  }

  /**
   * Route score adjustment from member measurements (docs/ROUTING.md, Measured roads). Fun scores run 0–100, so this is a real input:
   * - rough surface: up to -8 (same scale as core effective_mu: fine at 0.08 g rms, fully rough at 0.38 g);
   * - measured smooth surface: up to +3 (≤ 0.12 g rms);
   * - banked road (|camber| ≥ 3°): up to +2 when a tenth of the route is banked.
   * Weighted by how much of the route is measured (full weight at half) and by passes (one pass counts 3/4, two or more fully).
   * Unmeasured roads are neutral, never penalised or rewarded, so a route no one has driven is not disadvantaged.
   */
  function measuredAdjust(m) {
    if (!m || !(m.coverage > 0)) return 0;
    const cover = Math.min(1, m.coverage * 2), passes = m.avgPasses == null ? 1 : Math.min(1, 0.5 + m.avgPasses / 4), w = cover * passes;
    let adj = 0;
    if (m.roughness != null) {
      adj -= 8 * w * Math.max(0, Math.min(1, (m.roughness - 0.08) / 0.30));
      adj += 3 * w * Math.max(0, Math.min(1, (SMOOTH_G - m.roughness) / 0.07));
    }
    if (m.km > 0 && m.bankedKm > 0) adj += passes * Math.min(2, (m.bankedKm / m.km) * 20);
    return adj;
  }
  /** Surface 0–100 from measured roughness (100 = glass), or null when under a fifth of the route is measured. */
  function surfaceScore(m) {
    if (!m || m.roughness == null || !(m.coverage >= 0.2)) return null;
    return Math.round(100 * (1 - Math.max(0, Math.min(1, (m.roughness - 0.08) / 0.30))));
  }

  const api = { createLive, createAmbient, driveIdFor, measuredSeries, seriesFrom, measuredAdjust, surfaceScore, measuredAlong, summarize, locate, buildContributions, matchDrive, fetchWays, contributeDrive, eligible, project, cumulative, SKIP_CLASSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexContributor = api;
})(typeof window !== 'undefined' ? window : globalThis);
