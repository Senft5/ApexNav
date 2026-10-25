// Optional server sync for segments (docs/BACKEND.md). Everything works without it: when /api does not answer or the
// person is not a signed-in member, these calls resolve to null and local data is untouched.
(function (root) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const call = async (method, path, body) => {
    try {
      const r = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-apexnav': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
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

  /** Uploads one road contribution. true = accepted, false = skipped (already contributed / rejected), 'stop' = not enabled or rate limited. */
  async function contribute(c) {
    try {
      const r = await fetch('/api/contribute', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-apexnav': '1' },
        body: JSON.stringify({ way_id: c.way_id, dir: c.dir, driven_on: c.driven_on, bins: c.bins }) });
      return r.status === 202 ? true : r.status === 403 || r.status === 429 ? 'stop' : false;
    } catch (_) { return 'stop'; }
  }
  const contributionEnabled = async () => { const e = await call('GET', '/api/me/export'); return !!(e && e.member && e.member.contribute); };

  const api = { contribute, contributionEnabled, publishScore, board, highlightsNear, shareHighlight, rateHighlight, member, pushSegments, sharedWithMe, adopt, shareSegment, friends, removeRemote, toServer, fromServer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
