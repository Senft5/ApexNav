// Optional server sync for segments (docs/BACKEND.md). Everything works without it: when /api does not answer or the
// person is not a signed-in member, these calls resolve to null and local data is untouched.
(function (root) {
  const list = (v) => (Array.isArray(v) ? v : []);
  // The iOS app serves these pages from apexnav://app, so /api is the Worker, cross-origin. The session token the shell got
  // at sign-in lives in the iOS Keychain (IDEAS Z-10) and the shell makes the call (ApexApiBridge, `apexApi`), so page
  // script never holds it. On the web it is same-origin with the session cookie (HttpOnly).
  const IN_APP = typeof location !== 'undefined' && location.protocol === 'apexnav:';
  const API_BASE = IN_APP ? 'https://apexnav.senftns.workers.dev' : '';
  const TOKEN_KEY = 'apex.session', SIGNED_KEY = 'apex.signedIn';   // the token (older builds only) / a plain "signed in" flag
  const bridge = () => (IN_APP && root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.apexApi) || null;
  const store = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (_) {} };
  const token = () => { try { return IN_APP && !bridge() ? localStorage.getItem(TOKEN_KEY) : null; } catch (_) { return null; } };
  /** After a sign-in (`t` from an older shell, or true when the shell kept it) or a sign-out (null). */
  let pending = null;                                                   // a Keychain change the next call waits for
  function setSession(t) {
    const b = bridge();
    if (b) {
      store(TOKEN_KEY, null);
      if (typeof t === 'string') pending = Promise.resolve(b.postMessage({ cmd: 'adopt', token: t })).catch(() => {});
      else if (!t) pending = Promise.resolve(b.postMessage({ cmd: 'signOut' })).catch(() => {});
    } else if (typeof t === 'string' || !t) store(TOKEN_KEY, t || null);
    store(SIGNED_KEY, t ? '1' : null);
  }
  // A session an older build left in page storage moves into the Keychain once, then leaves the page.
  try { const old = bridge() && localStorage.getItem(TOKEN_KEY); if (old) { setSession(old); } } catch (_) {}
  /** fetch() for /api/* from either shell. Rejects when offline, like fetch. */
  async function apiFetch(path, init = {}) {
    const headers = { 'x-apexnav': '1', ...(init.headers || {}) };
    const b = bridge();
    if (b) {
      if (init.body != null && typeof init.body !== 'string') throw new TypeError('apiFetch: string bodies only in the app');
      if (pending) await pending;
      let r;
      try { r = await b.postMessage({ cmd: 'fetch', path, method: init.method || 'GET', headers, body: init.body == null ? null : init.body }); }
      catch (e) { throw new TypeError('Load failed'); }                       // offline, like fetch
      const status = r && r.status >= 200 && r.status <= 599 ? r.status : 502;
      const empty = [204, 205, 304].includes(status);
      return new Response(empty ? null : (r && r.body) || '', { status, headers: r && r.type ? { 'content-type': r.type } : {} });
    }
    const t = token();
    if (t) headers.authorization = 'Bearer ' + t;
    return fetch(API_BASE + path, { ...init, headers, credentials: IN_APP ? 'omit' : 'same-origin' });
  }
  /** Does this phone hold a session? (The app keeps it in the Keychain; this is only the page's flag.) */
  const signedIn = () => { try { return !!(localStorage.getItem(SIGNED_KEY) || localStorage.getItem(TOKEN_KEY)); } catch (_) { return false; } };
  /** Google sign-in: the web follows the Worker's redirect; the app asks the native shell (Google refuses embedded web views). */
  function signIn() {
    const native = IN_APP && root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.apex;
    if (native) native.postMessage({ cmd: 'signIn' }); else location.href = '/api/auth/google/start';
  }
  /** Sign in with Apple: the app only (Apple's native sheet; the web would need a Services ID). Answers like signIn. */
  function signInApple() {
    const native = IN_APP && root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.apex;
    if (native) native.postMessage({ cmd: 'signInApple' });
  }
  const call = async (method, path, body) => {
    try {
      const r = await apiFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!r.ok) return null;
      return r.status === 204 ? {} : await r.json();
    } catch (_) { return null; }
  };
  const toServer = (s) => ({ id: s.id, name: s.name, length_m: Math.max(100, s.length_m), geom: s.geom || JSON.stringify([[s.lat0, s.lon0], [s.lat1, s.lon1]]),
                             start_lat: s.lat0, start_lon: s.lon0, end_lat: s.lat1, end_lon: s.lon1 });
  const fromServer = (r) => ({ id: r.id, name: r.name, length_m: r.length_m, geom: r.geom, lat0: r.start_lat, lon0: r.start_lon, lat1: r.end_lat, lon1: r.end_lon,
                               origin: r.canon_id || r.origin_id || null, synced: true });

  /** Signed-in member, or null. */
  async function member() { const me = await call('GET', '/api/me'); return me && me.signed_in && me.member ? me : null; }

  /** A segment id that won't collide with anyone else's (ids are global on the server; IDEAS Y-14): time plus 48 random bits. */
  function newSegmentId() {
    const r = new Uint8Array(6);
    try { crypto.getRandomValues(r); } catch (_) { for (let i = 0; i < 6; i++) r[i] = Math.floor(Math.random() * 256); }
    return 'seg_' + Date.now() + '_' + Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Uploads local segments the server has not seen (idempotent by local id). Returns how many were sent, or null when offline/signed out.
   * A never-synced segment whose id someone else already holds (409 id_taken, an old `seg_<ms>` id) gets a fresh id and is sent again.
   */
  async function pushSegments(segs) {
    if (!(await member())) return null;
    let sent = 0;
    for (const s of segs) {
      if (s.synced) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        let r = null;
        try { r = await apiFetch('/api/segments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toServer(s)) }); } catch (_) {}
        if (r && r.ok) { s.synced = true; sent++; break; }
        if (!r || r.status !== 409 || attempt) break;
        s.id = newSegmentId();                                   // the page saves the list after this call
      }
    }
    return sent;
  }
  const sharedWithMe = async () => list(await call('GET', '/api/segments/shared')).map((r) => ({ ...fromServer(r), from_handle: r.from_handle }));
  async function adopt(seg) { const r = await call('POST', '/api/segments/adopt', { segment_id: seg.origin || seg.id }); return r && r.id ? { ...seg, id: r.id, synced: true } : null; }
  const shareSegment = (id, audienceType, audienceId) => call('POST', `/api/segments/${encodeURIComponent(id)}/share`, { audience_type: audienceType, audience_id: audienceId });
  const friends = async () => list(await call('GET', '/api/friends')).filter((f) => f.status === 'accepted');
  const crews = async () => list(await call('GET', '/api/crews'));
  const crewMembers = async (id) => list(await call('GET', `/api/crews/${encodeURIComponent(id)}/members`));
  const removeRemote = (id) => call('DELETE', `/api/segments/${encodeURIComponent(id)}`);

  /** Shared highlights in a box around a point (about 0.25 degrees each way); [] when offline. Scores are shrunk toward 3 stars by the server. */
  async function highlightsNear(c, deg = 0.25) {
    const r = await call('GET', `/api/highlights?bbox=${[c.lat - deg, c.lon - deg, c.lat + deg, c.lon + deg].map((v) => v.toFixed(5)).join(',')}`);
    return list(r).map((h) => ({ id: 'srv_' + h.id, name: h.name, lat: h.lat, lon: h.lon, rating: h.score, ratings: h.ratings, server: true, mine: !!h.mine,
      category: h.category || 'other', note: h.note || null, visits: h.visits || 0, myStars: h.my_stars ?? null }));
  }
  const shareHighlight = (h, category) => call('POST', '/api/highlights', { name: h.name, category, lat: h.lat, lon: h.lon });
  const rateHighlight = (id, stars, visited = false) => call('POST', `/api/highlights/${encodeURIComponent(id.replace(/^srv_/, ''))}/rating`, { stars, visited });

  /** Publishes one pass; the server delivers it only to friends/crews you granted (Account). Safe to repeat. */
  const publishScore = (segmentId, score, timeS, day) => call('POST', '/api/board', { segment_id: segmentId, driver_score: Math.round(score), time_s: timeS == null ? null : Math.max(1, Math.round(timeS)), driven_on: day });
  const board = async (canonId) => list(await call('GET', `/api/board/${encodeURIComponent(canonId)}`));
  /** Friends' activity on your stages (IDEAS S-03); [] signed out or offline. */
  const activity = async () => list(await call('GET', '/api/board/activity'));
  /** Kudos (IDEAS S-07) on a friend's run (handle, stage canon id, day): true when it went through. Kudos on your runs: []. */
  const kudos = async (run, on) => !!(await call(on ? 'POST' : 'DELETE', '/api/kudos', { handle: run.handle, canon_id: run.canon_id, driven_on: run.driven_on }));
  const kudosReceived = async () => list(await call('GET', '/api/kudos'));

  /**
   * Uploads one road contribution. true = accepted, false = rejected (bad data: never resend), 'stop' = signed out or not enabled,
   * 'retry' = offline, rate limited or a server error (resend the same payload later; the server merges a repeated chunk once).
   */
  async function contribute(c) {
    let r;
    try {
      r = await apiFetch('/api/contribute', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ way_id: c.way_id, dir: c.dir, driven_on: c.driven_on, drive_id: c.drive_id, bins: c.bins }) });
    } catch (_) { return 'retry'; }
    return r.status === 202 ? true : r.status === 401 || r.status === 403 ? 'stop' : r.status === 429 || r.status >= 500 ? 'retry' : false;
  }
  const contributionEnabled = async () => { const e = await call('GET', '/api/me/export'); return !!(e && e.member && e.member.contribute); };

  const api = { inApp: IN_APP, apiBase: API_BASE, apiFetch, signIn, signInApple, setSession, signedIn, contribute, newSegmentId, contributionEnabled, publishScore, board, activity, kudos, kudosReceived, highlightsNear, shareHighlight, rateHighlight, member, pushSegments, sharedWithMe, adopt, shareSegment, friends, crews, crewMembers, removeRemote, toServer, fromServer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
