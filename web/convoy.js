// Convoy client (docs/CONVOY_TRANSPORT.md): the live link to a group drive, plus the small amount of geometry it needs.
// Pure helpers (polyline, projection, relevance, gap, phrases) are exported for tests; ConvoyClient owns the socket.
// Nothing here is stored: a convoy lives in memory on the phone and on the server, and is gone when it ends.
(function (root) {
  const R = 6371008.8, RAD = Math.PI / 180, FT = 3.28084, MI = 1609.344;

  const haversineM = (a, b) => {
    const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  };
  const bearingDeg = (a, b) => {
    const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
    const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  };
  const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  // ---- Google encoded polyline, precision 5: [[lat, lon], ...] ----------------------------------
  function encodePolyline(pts) {
    let out = '', pLat = 0, pLon = 0;
    const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } out += String.fromCharCode(v + 63); };
    for (const [la, lo] of pts) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); enc(a - pLat); enc(b - pLon); pLat = a; pLon = b; }
    return out;
  }
  function decodePolyline(s) {
    const pts = []; let i = 0, lat = 0, lon = 0;
    const next = () => { let r = 0, sh = 0, b; do { if (i >= s.length) throw new Error('bad polyline'); b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20); return r & 1 ? ~(r >> 1) : r >> 1; };
    while (i < s.length) { lat += next(); lon += next(); pts.push([lat / 1e5, lon / 1e5]); }
    return pts;
  }
  /** Fewer points for the wire: keeps one every `stepM` metres (and the last), so a long route fits one message. */
  function thin(pts, stepM = 25) {
    if (pts.length <= 2) return pts.slice();
    const out = [pts[0]]; let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += haversineM({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] });
      if (acc >= stepM || i === pts.length - 1) { out.push(pts[i]); acc = 0; }
    }
    return out;
  }

  /** A route ready for projection: points plus cumulative distance (m). */
  function routeIndex(pts) {
    const dist = [0];
    for (let i = 1; i < pts.length; i++) dist.push(dist[i - 1] + haversineM({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] }));
    return { pts, dist, lengthM: dist[dist.length - 1] || 0 };
  }
  /** Nearest point on the route: { progressM, distM }. Local flat projection per segment, good to well under a metre at these scales. */
  function project(ri, p) {
    if (!ri || ri.pts.length < 2) return null;
    let best = null;
    const kx = Math.cos(p.lat * RAD) * RAD * R, ky = RAD * R;
    for (let i = 0; i < ri.pts.length - 1; i++) {
      const ax = (ri.pts[i][1] - p.lon) * kx, ay = (ri.pts[i][0] - p.lat) * ky, bx = (ri.pts[i + 1][1] - p.lon) * kx, by = (ri.pts[i + 1][0] - p.lat) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (!best || d < best.distM) best = { distM: d, progressM: ri.dist[i] + t * (ri.dist[i + 1] - ri.dist[i]) };
    }
    return best;
  }

  const ON_ROUTE_M = 60, AHEAD_ROUTE_M = 3000, AHEAD_GEO_M = 1600, NEAR_GEO_M = 600, CONE_DEG = 70;
  /**
   * How far ahead a hazard is for me, in metres, or null when it is not ahead (behind me, the other way, or too far).
   * On the shared route (same version, both on it) this is distance along the road. Otherwise it falls back to a straight
   * line inside a cone around my heading; with no heading only something very close counts.
   */
  function hazardAhead(ev, me, routeVersion) {
    const a = ev && ev.anchor;
    if (!a || !me || !Number.isFinite(me.lat) || !Number.isFinite(me.lon)) return null;
    if (a.progressM != null && a.routeVersion != null && a.routeVersion === routeVersion && me.progressM != null && (me.routeDistM == null || me.routeDistM <= ON_ROUTE_M)) {
      const d = a.progressM - me.progressM;
      return d > 0 && d <= AHEAD_ROUTE_M ? d : null;
    }
    const d = haversineM(me, a);
    if (Number.isFinite(me.heading) && (me.speedMps == null || me.speedMps >= 3)) return d <= AHEAD_GEO_M && angleDiff(bearingDeg(me, a), me.heading) <= CONE_DEG ? d : null;
    return d <= NEAR_GEO_M ? d : null;
  }

  /**
   * Gap to another car, as time when it means something (positive = they are ahead of me).
   * Along the shared route when both are on it, else straight-line distance (unsigned). Time uses my speed, floored so a
   * stop at a light does not turn a 300 m gap into ten minutes; below a crawl it is distance only.
   */
  function gap(them, me) {
    if (!them || !me) return null;
    const onRoute = them.progressM != null && me.progressM != null;
    const meters = onRoute ? them.progressM - me.progressM : haversineM(me, them);
    const v = me.speedMps;
    const seconds = Number.isFinite(v) && v >= 2 ? meters / Math.max(v, 8) : null;
    return { meters, seconds, signed: onRoute };
  }
  function gapText(g) {
    if (!g) return '--';
    const s = g.signed ? (g.meters >= 0 ? ' ahead' : ' behind') : ' away';
    if (g.seconds != null && Math.abs(g.seconds) < 600) return `${Math.round(Math.abs(g.seconds))} s${s}`;
    return `${distText(Math.abs(g.meters))}${s}`;
  }
  function distText(m) {
    if (m < 0.1 * MI) return `${Math.max(100, Math.round((m * FT) / 100) * 100)} ft`;
    return `${(m / MI).toFixed(m < 10 * MI ? 1 : 0)} mi`;
  }

  const KINDS = {
    bump: 'Bump', hard_braking: 'Hard braking', gravel: 'Gravel', debris: 'Debris', animal: 'Animal', police: 'Police', camera: 'Camera', stopped: 'Stopped car',
  };
  /** What the co-driver says. Spoken units: feet and miles, like the rest of the app. */
  function hazardPhrase(type, aheadM) {
    const what = KINDS[type] || 'Hazard';
    if (aheadM == null) return `${what} reported.`;
    if (aheadM < 120) return `${what}, now.`;
    const t = distText(aheadM), d = t.endsWith(' ft') ? t.replace(' ft', ' feet') : t === '1.0 mi' ? '1 mile' : t.replace(' mi', ' miles');
    return `${what} ahead, ${d}.`;
  }

  const newId = () => {
    const b = new Uint8Array(12); (root.crypto || globalThis.crypto).getRandomValues(b);
    return 'evt-' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  };

  /**
   * One live convoy connection. `apiFetch(path, init)` is ApexSync.apiFetch; `wsUrl(id)` builds the socket URL.
   * Calls `onChange(snapshot)` after anything changes and `onHazard(event)` for each new (not replayed-twice) hazard.
   */
  class ConvoyClient {
    constructor({ apiFetch, wsUrl, WebSocketImpl, onChange = () => {}, onHazard = () => {}, onRetract = () => {}, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
      Object.assign(this, { apiFetch, wsUrl, WS: WebSocketImpl || root.WebSocket, onChange, onHazard, onRetract, now, setTimer, clearTimer });
      this.reset();
    }
    reset() {
      this.id = null; this.ctx = null; this.status = 'off'; this.ws = null; this.lastSeq = 0; this.epoch = null;
      this.members = new Map(); this.positions = new Map(); this.events = new Map(); this.route = null; this.routeIdx = null; this.regroup = null;
      this.retry = 0; this.timer = null; this.lastPosAt = 0; this.pending = [];
    }
    snapshot() {
      return { id: this.id, status: this.status, ctx: this.ctx, members: [...this.members.values()], positions: new Map(this.positions),
               events: [...this.events.values()].filter((e) => e.action === 'hazard'), route: this.route, routeIdx: this.routeIdx, regroup: this.regroup };
    }
    changed() { try { this.onChange(this.snapshot()); } catch (_) { /* UI errors never break the link */ } }
    async post(path, body) {
      try {
        const r = await this.apiFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        let j = null; try { j = await r.json(); } catch (_) { /* empty */ }
        return { status: r.status, ok: r.ok, body: j };
      } catch (_) { return { status: 0, ok: false, body: null }; }
    }
    async start(name) {
      const r = await this.post('/api/convoy', { consent: true, name: name || undefined });
      if (!r.ok) return r;
      this.adopt(r.body.context);
      this.invite = r.body.invite;
      this.connect();
      return r;
    }
    async join(invite) {
      const r = await this.post('/api/convoy/join', { consent: true, invite });
      if (!r.ok) return r;
      this.adopt(r.body);
      this.connect();
      return r;
    }
    /** Back into a convoy this phone was in (after a reload); quietly gives up if it ended. */
    async resume(id) {
      try {
        const r = await this.apiFetch(`/api/convoy/${encodeURIComponent(id)}`, { method: 'GET' });
        if (!r.ok) return false;
        this.adopt(await r.json());
        this.connect();
        return true;
      } catch (_) { return false; }
    }
    adopt(ctx) {
      this.id = ctx.sessionId; this.ctx = ctx; this.status = 'connecting';
      for (const m of ctx.members || []) this.members.set(m.key, m);
      this.changed();
    }
    async newInvite() {
      const r = await this.post(`/api/convoy/${this.id}/invite`);
      if (r.ok) this.invite = r.body.invite;
      return r.ok ? r.body.invite : null;
    }
    async leave() {
      const id = this.id;
      this.stop('left');
      if (id) await this.post(`/api/convoy/${id}/leave`);
    }
    async removeMember(key) { return (await this.post(`/api/convoy/${this.id}/remove`, { member: key })).ok; }
    stop(status = 'off') {
      this.clearTimer(this.timer);
      const ws = this.ws; this.ws = null;
      if (ws) { try { ws.close(1000, 'bye'); } catch (_) { /* gone */ } }
      this.reset();
      this.status = status;
      this.changed();
    }

    async connect() {
      if (!this.id || this.ws) return;
      this.status = this.retry ? 'reconnecting' : 'connecting'; this.changed();
      const t = await this.post(`/api/convoy/${this.id}/ticket`);
      if (!this.id) return;                                               // left while waiting
      if (t.status === 404 || t.status === 401 || t.status === 403) return this.stop('ended');
      if (!t.ok) return this.later();
      let ws;
      try { ws = new this.WS(this.wsUrl(this.id)); } catch (_) { return this.later(); }
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'authenticate', ticket: t.body.ticket, epoch: this.epoch, afterSeq: this.lastSeq }));
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } this.onMessage(m); };
      ws.onclose = (e) => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (e && (e.code === 4000 || e.code === 4403)) return this.stop(e.code === 4403 ? 'removed' : 'ended');
        this.status = 'reconnecting'; this.changed();
        this.later();
      };
      ws.onerror = () => { /* onclose follows */ };
    }
    later() {
      this.clearTimer(this.timer);
      const ms = Math.min(15000, 1000 * 2 ** this.retry++);
      this.timer = this.setTimer(() => { this.timer = null; this.connect(); }, ms);
    }
    send(m) { if (this.ws && this.status === 'live') { try { this.ws.send(JSON.stringify(m)); return true; } catch (_) { /* closing */ } } return false; }

    onMessage(m) {
      switch (m.type) {
        case 'ready': {
          this.retry = 0;
          if (this.epoch !== null && m.context.leaderEpoch !== this.epoch) { this.events.clear(); this.lastSeq = 0; }   // server restarted: old events are void
          this.epoch = m.context.leaderEpoch; this.ctx = m.context; this.status = 'live';
          this.members = new Map(m.context.members.map((x) => [x.key, x]));
          this.positions = new Map((m.positions || []).map((p) => [p.key, p]));
          this.setRoute(m.route); this.regroup = m.regroup || null;
          for (const ev of m.events || []) this.takeEvent(ev);
          for (const p of this.pending.splice(0)) this.send(p);
          break;
        }
        case 'position': this.positions.set(m.key, m); break;
        case 'presence': { const x = this.members.get(m.key); if (x) x.online = m.online; break; }
        case 'member':
          if (m.action === 'joined') this.members.set(m.member.key, { ...m.member, online: false });
          else { this.members.delete(m.member.key); this.positions.delete(m.member.key); }
          break;
        case 'event': this.takeEvent(m.event); break;
        case 'route': this.setRoute(m.route); break;
        case 'regroup': this.regroup = m.regroup; break;
        case 'ended': return this.stop('ended');
        default: return;   // ack, pong, error: nothing to redraw
      }
      this.changed();
    }
    takeEvent(ev) {
      if (!ev || ev.leaderEpoch !== this.epoch) return;
      this.lastSeq = Math.max(this.lastSeq, ev.seq);
      const prev = this.events.get(ev.eventId);
      if (prev && (prev.action === 'retract' || prev.seq >= ev.seq)) return;   // duplicate, or late after a retraction
      this.events.set(ev.eventId, ev);
      try { if (ev.action === 'hazard') this.onHazard(ev); else if (prev) this.onRetract(ev); } catch (_) { /* UI */ }
    }
    setRoute(r) {
      this.route = r || null;
      try { this.routeIdx = r ? routeIndex(decodePolyline(r.polyline)) : null; } catch (_) { this.routeIdx = null; }
    }
    /** Hazards still live, oldest first; expired ones drop out. */
    liveHazards() {
      const t = this.now();
      for (const [id, e] of this.events) if (e.expiresAtMs <= t) this.events.delete(id);
      return [...this.events.values()].filter((e) => e.action === 'hazard');
    }
    /** My fix, with progress on the shared route when there is one. */
    locate(fix) {
      if (!fix) return null;
      const pr = this.routeIdx ? project(this.routeIdx, fix) : null;
      return { ...fix, progressM: pr && pr.distM <= ON_ROUTE_M ? pr.progressM : null, routeDistM: pr ? pr.distM : null };
    }
    /** At most once a second; the server drops anything faster. */
    sendPosition(fix) {
      const t = this.now();
      if (!fix || t - this.lastPosAt < 1000) return false;
      const me = this.locate(fix);
      const msg = { type: 'position', lat: +me.lat.toFixed(6), lon: +me.lon.toFixed(6) };
      if (Number.isFinite(me.heading)) msg.heading = Math.round(((me.heading % 360) + 360) % 360);
      if (Number.isFinite(me.speedMps)) msg.speedMps = Math.max(0, Math.min(120, +me.speedMps.toFixed(1)));
      if (me.progressM != null) msg.progressM = Math.round(me.progressM);
      if (!this.send(msg)) return false;
      this.lastPosAt = t;
      this.positions.set(this.ctx.you, { key: this.ctx.you, ...msg, at: t });
      return true;
    }
    /** Leader: call out a hazard where I am now. Sent at once; `retract(id)` takes it back. */
    callHazard(type, fix, source = 'manual') {
      const me = this.locate(fix);
      if (!me) return null;
      const anchor = { lat: +me.lat.toFixed(6), lon: +me.lon.toFixed(6) };
      if (me.progressM != null && this.route) { anchor.progressM = Math.round(me.progressM); anchor.routeVersion = this.route.version; anchor.direction = 1; }
      const event = { eventId: newId(), type, action: 'hazard', observedAtMs: this.now(), anchor, source };
      const msg = { type: 'publish', event };
      if (!this.send(msg)) this.pending.push(msg);
      return event.eventId;
    }
    retract(eventId) {
      const prev = this.events.get(eventId);
      const msg = { type: 'publish', event: { eventId, type: prev ? prev.type : 'bump', action: 'retract', observedAtMs: this.now() } };
      this.pending = this.pending.filter((p) => p.event.eventId !== eventId);
      this.send(msg);
    }
    shareRoute(name, pts) {
      const polyline = encodePolyline(thin(pts));
      if (polyline.length > 30000) return false;
      const version = (this.route ? this.route.version : 0) + 1;
      return this.send({ type: 'route', route: { name: String(name || 'Route').slice(0, 60), polyline, version } });
    }
    clearRoute() { return this.send({ type: 'route', route: null }); }
    callRegroup(fix, note) { return fix ? this.send({ type: 'regroup', at: { lat: +fix.lat.toFixed(6), lon: +fix.lon.toFixed(6), note: note || null } }) : false; }
    clearRegroup() { return this.send({ type: 'regroup', at: null }); }
  }

  const api = { ConvoyClient, KINDS, encodePolyline, decodePolyline, thin, routeIndex, project, hazardAhead, gap, gapText, distText, hazardPhrase, haversineM, bearingDeg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexConvoy = api;
})(typeof window !== 'undefined' ? window : globalThis);
