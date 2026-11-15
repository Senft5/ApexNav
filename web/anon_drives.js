// Anonymous drives (the owner, 2026-11-15: regular users' drives "upload without any user data associated"; "Help improve
// Vetta roads", on by default, Garage → Settings → Road feel; backend/src/anon_drives.ts). A copy of each drive recorded on
// this phone, made anonymous here before anything leaves:
//   - no account, name, note, tags, car, drive id or clock time: a fresh random id per piece, the day and the hour only;
//   - the first and last ANON_TRIM_M (a random 1 to 1.5 km each, so the cut can't be measured back; the
//     Road feel promise, "the first and last km of every trip stay on this phone", holds for these too) never leave the phone;
//   - nothing inside a privacy zone: the drive is cut there into pieces, each sent on its own with no link between them;
//   - pieces under MIN_PIECE_M are not sent. Imported drives (someone else's file, maybe) are never sent.
// The driver's own drive, its replay and its page are never changed: this is a copy for the upload only.
// anonymize() is pure (tests/test_anon_drives.py); sync() is the thin network shell.
(function (root) {
  'use strict';
  const SENT_KEY = 'apex.anonDrives.sent', AGE_KEY = 'apex.ageBand', SINCE_KEY = 'apex.anonDrives.since';   // since: switched on again then
  const TRIM_MIN_M = 1000, TRIM_MAX_M = 1500, MIN_PIECE_M = 2000, MAX_AGE_DAYS = 30, PER_SYNC = 3;
  const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  // the per-sample columns a piece carries (each the drive's own, sliced); everything else on the record stays on the phone
  const COLS = ['lat', 'lon', 'dist', 'speed_mps', 'lon_g', 'lat_g', 'g_known', 'elev', 'camber', 'rough', 'crest', 'vpeak', 'kappa', 'envMps', 'sightM', 't_s'];
  const NEVER = new Set(['imported', 'demo', 'sample']);
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  const randomId = (rng) => Array.from({ length: 16 }, () => Math.floor(rng() * 16).toString(16)).join('');
  /** The day and the hour the drive started ("2026-11-14T19"), or null: never the minute. */
  function hourOf(date) {
    const m = typeof date === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2})/.exec(date);
    return m ? `${m[1]}T${m[2]}` : null;
  }
  const ageBand = (store) => { try { const v = store && store.getItem(AGE_KEY); return AGE_BANDS.includes(v) ? v : null; } catch (_) { return null; } };

  /**
   * The anonymous pieces of a drive: [] when nothing may go. inZone(lat, lon) says a point is in a privacy zone; rng is
   * Math.random in the app (a seeded one in tests); extra = { age } (an age band or null).
   */
  function anonymize(d, inZone, rng = Math.random, extra = {}) {
    if (!d || !Array.isArray(d.lat) || !Array.isArray(d.lon) || !Array.isArray(d.dist) || NEVER.has(d.source)) return [];
    const n = Math.min(d.lat.length, d.lon.length, d.dist.length);
    if (n < 2) return [];
    const end = d.dist[n - 1];
    if (!finite(end)) return [];
    const head = TRIM_MIN_M + rng() * (TRIM_MAX_M - TRIM_MIN_M), tail = TRIM_MIN_M + rng() * (TRIM_MAX_M - TRIM_MIN_M);
    const runs = []; let run = null;
    for (let i = 0; i < n; i++) {
      const la = d.lat[i], lo = d.lon[i], s = d.dist[i];
      const keep = finite(la) && finite(lo) && finite(s) && s >= head && s <= end - tail && !inZone(la, lo);
      if (keep) { if (!run) runs.push(run = [i, i]); else run[1] = i; }
      else run = null;                                                   // a gap, a zone or an end cuts the piece there
    }
    const hour = hourOf(d.date), age = AGE_BANDS.includes(extra.age) ? extra.age : null;
    return runs.filter(([a, b]) => d.dist[b] - d.dist[a] >= MIN_PIECE_M).map(([a, b]) => {
      const p = { v: 1, id: randomId(rng), hour, source: d.source || null, cam_v: d.cam_v ?? null, hz: d.hz ?? null, age };
      for (const k of COLS) if (Array.isArray(d[k])) p[k] = d[k].slice(a, b + 1);
      const d0 = p.dist[0]; p.dist = p.dist.map((x) => (finite(x) ? x - d0 : x));       // measured from the piece's start
      if (Array.isArray(p.t_s)) { const t0 = p.t_s.find(finite); if (finite(t0)) p.t_s = p.t_s.map((x) => (finite(x) ? x - t0 : x)); }
      return p;
    });
  }

  const read = (store) => { try { const v = JSON.parse(store.getItem(SENT_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
  const write = (store, ids) => { try { store.setItem(SENT_KEY, JSON.stringify(ids.slice(-2000))); } catch (_) {} };
  async function gzip(text) {
    if (typeof root.CompressionStream !== 'function' || typeof root.Response !== 'function') return null;
    const s = new root.Blob([text]).stream().pipeThrough(new root.CompressionStream('gzip'));
    return new Uint8Array(await new root.Response(s).arrayBuffer());
  }
  // the last MAX_AGE_DAYS days, and never a drive from while the switch was off (driven before it was last switched on)
  const recent = (d, now, store) => {
    const t = Date.parse(d && d.date);
    let since = NaN; try { since = Date.parse(store.getItem(SINCE_KEY) || ''); } catch (_) {}
    return Number.isFinite(t) && now - t <= MAX_AGE_DAYS * 864e5 && !(Number.isFinite(since) && t < since);
  };

  let running = null;
  /**
   * Sends the anonymous pieces of up to PER_SYNC drives not sent yet (the last MAX_AGE_DAYS days), one drive at a time.
   * deps: { ids(), get(id), post(bytes) → ok?, store, allowed(), inZone(lat, lon), now?, rng? }. Stops at the first failure.
   * A drive is marked sent once all its pieces are up (a drive with none is marked too, so it isn't read again).
   */
  function sync(deps) {
    if (running) return running;
    running = (async () => {
      let sent = 0, pieces = 0;
      const done = new Set(read(deps.store)), now = deps.now ? deps.now() : Date.now();
      for (const id of await deps.ids()) {
        if (sent >= PER_SYNC || !deps.allowed()) break;
        if (typeof id !== 'string' || done.has(id)) continue;
        const d = await deps.get(id);
        if (!d || !recent(d, now, deps.store)) { done.add(id); write(deps.store, [...done]); continue; }
        const ps = anonymize(d, deps.inZone, deps.rng || Math.random, { age: ageBand(deps.store) });
        let ok = true;
        for (const p of ps) {
          const bytes = await gzip(JSON.stringify(p));
          if (!bytes) { ok = false; break; }
          try { ok = !!(await deps.post(bytes)); } catch (_) { ok = false; }
          if (!ok) break;
          pieces++;
        }
        if (!ok) break;
        done.add(id); sent++;
        write(deps.store, [...done]);
      }
      return { sent, pieces };
    })().finally(() => { running = null; });
    return running;
  }

  const api = { anonymize, sync, hourOf, ageBand, gzip, AGE_BANDS, AGE_KEY, SENT_KEY, SINCE_KEY, TRIM_MIN_M, TRIM_MAX_M, MIN_PIECE_M, PER_SYNC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexAnonDrives = api;
})(typeof window !== 'undefined' ? window : globalThis);
