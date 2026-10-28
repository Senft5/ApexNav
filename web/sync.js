// Optional server sync for segments (docs/BACKEND.md). Everything works without it: when /api does not answer or the
// person is not a signed-in member, these calls resolve to null and local data is untouched.
(function (root) {
  const list = (v) => (Array.isArray(v) ? v : []);
  // The iOS app serves these pages from apexnav://app, so /api is the Worker, cross-origin, and the session travels as a
  // bearer token the shell obtained through ASWebAuthenticationSession (stored in this origin's localStorage, never in
  // the bundle). On the web it is same-origin with the session cookie.
  const IN_APP = typeof location !== 'undefined' && location.protocol === 'apexnav:';
  const API_BASE = IN_APP ? 'https://apexnav.senftns.workers.dev' : '';
  const TOKEN_KEY = 'apex.session';
  const token = () => { try { return IN_APP ? localStorage.getItem(TOKEN_KEY) : null; } catch (_) { return null; } };
  function setSession(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (_) {} }
  /** fetch() for /api/* from either shell. Rejects when offline, like fetch. */
  function apiFetch(path, init = {}) {
    const headers = { 'x-apexnav': '1', ...(init.headers || {}) };
    const t = token();
    if (t) headers.authorization = 'Bearer ' + t;
    return fetch(API_BASE + path, { ...init, headers, credentials: IN_APP ? 'omit' : 'same-origin' });
  }
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

  /** Uploads local segments the server has not seen (idempotent by local id). Returns how many were sent, or null when offline/signed out. */
  async function pushSegments(segs) {
    if (!(await member())) return null;
    let sent = 0;
    for (const s of segs) {
      if (s.synced) continue;
      if (await call('POST', '/api/segments', toServer(s))) { s.synced = true; sent++; }
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
    return list(r).map((h) => ({ id: 'srv_' + h.id, name: h.name, lat: h.lat, lon: h.lon, rating: h.score, ratings: h.ratings, server: true, mine: !!h.mine }));
  }
  const shareHighlight = (h, category) => call('POST', '/api/highlights', { name: h.name, category, lat: h.lat, lon: h.lon });
  const rateHighlight = (id, stars, visited = false) => call('POST', `/api/highlights/${encodeURIComponent(id.replace(/^srv_/, ''))}/rating`, { stars, visited });

  /** Publishes one pass; the server delivers it only to friends/crews you granted (Account). Safe to repeat. */
  const publishScore = (segmentId, score, timeS, day) => call('POST', '/api/board', { segment_id: segmentId, driver_score: Math.round(score), time_s: timeS == null ? null : Math.max(1, Math.round(timeS)), driven_on: day });
  const board = async (canonId) => list(await call('GET', `/api/board/${encodeURIComponent(canonId)}`));
  /** Friends' activity on your stages (IDEAS S-03); [] signed out or offline. */
  const activity = async () => list(await call('GET', '/api/board/activity'));

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

  const api = { inApp: IN_APP, apiBase: API_BASE, apiFetch, signIn, signInApple, setSession, contribute, contributionEnabled, publishScore, board, activity, highlightsNear, shareHighlight, rateHighlight, member, pushSegments, sharedWithMe, adopt, shareSegment, friends, crews, crewMembers, removeRemote, toServer, fromServer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
