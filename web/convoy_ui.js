// Convoy on screen: the strip over the map, the convoy sheet it opens, the panel a crew drive's card shows while its
// convoy is live, cars and hazards on the map, and the co-driver's hazard calls. A convoy is a state of the run, not a
// section of its own (docs/design/REVIEW_PEOPLE.md P-11): a crew's starts from its drive's card (crew_events.js), an
// ad-hoc one from the map's Start key ("Convoy now"), and an invite waits on the drive's card and on the map's line. The page hands in what it owns (map, position, voice, toasts) through mount(); the link and
// geometry live in convoy.js. Every name, handle and note is set as text, never as HTML.
// Buttons are rebuilt only when what they do changes (role, members, status, undo); positions move text and markers
// in place, so a tap is never lost to a repaint while driving.
(function (root) {
  const C = root.ApexConvoy;
  const RESUME_KEY = 'apex.convoy', INVITE_KEY = 'apex.convoyInvite', UNDO_MS = 3000, TICK_MS = 1000, NEAR_M = 200;
  const LEADER_CALLS = ['bump', 'gravel', 'debris', 'animal', 'police', 'stopped'];
  // Storage can be missing or throw (private mode, blocked site data): every access goes through here.
  const store = {
    get: (which, k) => { try { return root[which].getItem(k) || ''; } catch (_) { return ''; } },
    set: (which, k, v) => { try { if (v) root[which].setItem(k, v); else root[which].removeItem(k); } catch (_) { /* private mode */ } },
  };
  const ERRORS = { capacity: 'Too many live calls. Wait a moment.', bad_event: 'That call was refused.', bad_route: 'That route could not be shared.',
                   bad_regroup: 'That regroup point was refused.', leader_only: 'Only the leader can do that.', frame_too_large: 'That was too big to send.' };
  const CSS = `
    .convoy-bar { position: absolute; left: 10px; right: 76px; top: calc(76px + var(--safe-top, 0px)); z-index: 5; display: none; gap: 6px; flex-direction: column;
      background: var(--panel); color: var(--panel-ink); border: 1px solid var(--rule); padding: 0; font-size: 13px; max-width: 420px; }
    /* P-21: on the idle map one slim line in the place plate's column, just under it, in the plate's own hand; a tap opens
       the convoy. Its status ("Reconnecting") is a word in the line, never a box of its own. */
    #app.idle .convoy-bar { top: calc(54px + var(--safe-top, 0px)); left: 10px; right: auto; max-width: calc(100% - 96px); padding: 0;
      border: 1.5px solid var(--panel-ink); box-shadow: 0 2px 0 var(--rule); }
    #app.plan-open .convoy-bar { display: none; }
    .convoy-bar .cv-line { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 10px; border: 0; background: none; color: inherit;
      font: 600 14px var(--font-ui, sans-serif); text-align: left; width: 100%; min-width: 0; }
    .convoy-bar .cv-line b { font-family: var(--font-num); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .convoy-bar .cv-line span { color: var(--panel-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-weight: 500; }
    .convoy-bar .cv-line i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--gain, #2a6); }
    .convoy-bar .cv-line i.off { background: var(--panel-dim); }
    .convoy-bar .cv-line i.ask { background: var(--accent); }
    .convoy-sheet .card-sheet { max-height: 86vh; overflow-y: auto; }
    .convoy-sheet .cv-sheet-head { display: flex; justify-content: space-between; align-items: center; }
    .convoy-sheet .cv-sheet-head h2 { margin: 0; }
    /* the owner's photos, 2026-10-30: a two-row block of calls over the map and the Layers key, before a drive had started.
       Now one line (name and status) off the right-hand keys; the calls come only in a drive, in one row that scrolls. */
    .convoy-bar.show { display: flex; }
    #app.sheet-open .convoy-bar { display: none; }
    .convoy-bar .cv-calls { display: flex; flex-wrap: nowrap; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 0 10px 6px; }
    .convoy-bar .cv-regroup { padding: 0 10px 6px; }
    .convoy-bar .cv-calls::-webkit-scrollbar { display: none; }
    .convoy-bar .cv-calls button { flex: none; min-height: 44px; min-width: 44px; padding: 0 10px; font-size: 13px; font-weight: 700; }
    .convoy-bar .cv-undo { color: var(--signal, #c33); border-color: var(--signal, #c33); }
    .convoy-dot { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--panel, #fff);
      background: var(--accent, #2a6); color: var(--panel, #fff); font: 800 11px var(--font-ui, sans-serif); box-shadow: 0 1px 4px rgba(0,0,0,.4); }
    .convoy-dot.leader { background: var(--panel-ink, #111); }
    .convoy-dot.stale { opacity: 0.45; }
    .convoy-pin { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; padding: 2px 5px; border: 1.5px solid var(--amber, #c80); color: var(--amber, #c80);
      background: var(--panel, #fff); white-space: nowrap; font-family: var(--font-ui, sans-serif); }
    .convoy-pin.regroup { border-color: var(--gain, #2a6); color: var(--gain, #2a6); }
    .cv-members { display: grid; gap: 4px; }
    .cv-qr { width: 232px; height: 232px; image-rendering: pixelated; border-radius: 8px; }
    .cv-member { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 44px; }
    .cv-member .cv-on { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--panel-dim); margin-right: 6px; }
    .cv-member .cv-on.live { background: var(--gain, #2a6); }
    .cv-member .cv-car { display: block; margin-left: 14px; font-size: 12px; color: var(--panel-dim); }
  `;

  function mount(page) {
    const { map, maplibregl, el, btn, toast, copyText, getFix, getRoute, speak, siteOrigin, wsUrl, apiFetch } = page;
    const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
    const bar = el('div', { className: 'convoy-bar' });
    bar.setAttribute('aria-label', 'Convoy');
    (page.overlayParent || document.body).append(bar);
    const labelled = (node, text) => { node.setAttribute('aria-label', text); return node; };

    let snap = null, undo = null, lastKey = null;
    const hosts = new Set();                                    // where the convoy draws: the sheet, a drive card's panel
    const watchers = new Set();                                 // drive cards: told when the convoy or its invites change
    const tellWatchers = () => { for (const fn of [...watchers]) { let keep = false; try { keep = fn() !== false; } catch (_) {} if (!keep) watchers.delete(fn); } };
    const spoken = new Map();                                   // eventId -> 'far' | 'near': each hazard is called at most twice
    const markers = { cars: new Map(), hazards: new Map(), regroup: null };
    let lastRegroup = null;
    const live = { headline: null, regroup: null, gaps: [], left: [] };   // text nodes updated in place

    const client = new C.ConvoyClient({
      apiFetch, wsUrl,
      onChange: (s, what) => { snap = s; store.set('localStorage', RESUME_KEY, s.id || ''); paint(what); },
      onHazard: () => tick(),
      onRetract: (ev) => { if (spoken.has(ev.eventId)) toast(`${C.KINDS[ev.type] || 'Hazard'} call cancelled by the leader.`); spoken.delete(ev.eventId); paintMap(); },
      onError: (code) => toast(ERRORS[code] || 'The convoy refused that.'),
    });

    const me = () => client.locate(getFix());
    const driving = () => !!(page.driving && page.driving());
    const isLeader = () => !!(snap && snap.ctx && snap.ctx.role === 'leader');
    const label = (m) => (m && m.handle ? '@' + m.handle : 'Driver');
    const initial = (m) => ((m && m.handle) || '?').slice(0, 1).toUpperCase();

    // ---- every second: send my position, call hazards that are ahead of me, move markers and text -----------------
    function tick() {
      if (!snap || !snap.id) return;
      const fix = getFix();
      if (fix) client.sendPosition(fix);
      const mine = me(), version = client.route ? client.route.version : null;
      for (const ev of client.liveHazards()) {
        if (snap.ctx && ev.leaderKey === snap.ctx.you) continue;            // my own call
        const ahead = C.hazardAhead(ev, mine, version), was = spoken.get(ev.eventId);
        if (ahead == null) continue;
        // Far calls wait their turn after the current pace note; a close one cuts in.
        if (!was) { spoken.set(ev.eventId, ahead < NEAR_M ? 'near' : 'far'); speak(C.hazardPhrase(ev.type, ahead), ahead < NEAR_M); }
        else if (was === 'far' && ahead < NEAR_M) { spoken.set(ev.eventId, 'near'); speak(C.hazardPhrase(ev.type, ahead), true); }
      }
      paintMap(); paintText();
      if (structKey() !== lastKey) paint();                             // a drive started or ended: the calls come or go
    }
    setInterval(tick, TICK_MS);

    // ---- map ----------------------------------------------------------------------------------------------------
    const ROUTE_SRC = 'apex-convoy-route';
    function routeLayer() {
      if (!map.isStyleLoaded || !map.isStyleLoaded()) return false;
      const fc = { type: 'FeatureCollection', features: client.routeIdx ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: client.routeIdx.pts.map(([la, lo]) => [lo, la]) } }] : [] };
      try {
        if (!map.getSource(ROUTE_SRC)) {
          map.addSource(ROUTE_SRC, { type: 'geojson', data: fc });
          map.addLayer({ id: ROUTE_SRC, type: 'line', source: ROUTE_SRC, paint: { 'line-color': '#7a5cff', 'line-width': 4, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] } });
        } else map.getSource(ROUTE_SRC).setData(fc);
        return true;
      } catch (_) { return false; }   // style swapping: next tick
    }
    let routeDrawnFor = null;
    function paintMap() {
      const want = snap && snap.id ? snap : null, t = Date.now();
      const cars = new Map(want ? [...client.positions].filter(([k]) => k !== want.ctx.you) : []);
      for (const [k, m] of markers.cars) if (!cars.has(k)) { m.remove(); markers.cars.delete(k); }
      for (const [k, p] of cars) {
        const who = client.members.get(k);
        let m = markers.cars.get(k);
        if (!m) { m = new maplibregl.Marker({ element: el('div', { className: 'convoy-dot' }) }).setLngLat([p.lon, p.lat]).addTo(map); markers.cars.set(k, m); }
        const dot = m.getElement();
        dot.textContent = initial(who);
        dot.className = 'convoy-dot' + (who && who.role === 'leader' ? ' leader' : '') + (t - p.at > 15000 ? ' stale' : '');
        dot.title = label(who);
        dot.setAttribute('aria-label', `${label(who)}${who && who.role === 'leader' ? ', leader' : ''}`);
        m.setLngLat([p.lon, p.lat]);
      }
      const hz = new Map(want ? client.liveHazards().map((e) => [e.eventId, e]) : []);
      for (const [k, m] of markers.hazards) if (!hz.has(k)) { m.remove(); markers.hazards.delete(k); }
      for (const [k, e] of hz) {
        if (markers.hazards.has(k) || !e.anchor) continue;
        const pin = el('div', { className: 'convoy-pin', textContent: (C.KINDS[e.type] || 'Hazard').toUpperCase() });
        markers.hazards.set(k, new maplibregl.Marker({ element: pin }).setLngLat([e.anchor.lon, e.anchor.lat]).addTo(map));
      }
      // a new regroup point: the page says it (crew_voice.js: a Factory crew's own line, else "Regroup at ...")
      const rgKey = client.regroup ? `${client.regroup.lat},${client.regroup.lon},${client.regroup.note || ''}` : null;
      if (want && rgKey && rgKey !== lastRegroup && page.onRegroup) page.onRegroup(client.regroup, want && want.ctx ? want.ctx.name : '');
      lastRegroup = rgKey;
      const rg = want && client.regroup;
      if (!rg && markers.regroup) { markers.regroup.remove(); markers.regroup = null; }
      if (rg) {
        if (!markers.regroup) markers.regroup = new maplibregl.Marker({ element: el('div', { className: 'convoy-pin regroup' }) }).addTo(map);
        markers.regroup.getElement().textContent = 'Regroup' + (rg.note ? ` · ${rg.note}` : '');
        markers.regroup.setLngLat([rg.lon, rg.lat]);
      }
      const routeKey = want && client.route ? client.route.version : null;
      if (routeKey !== routeDrawnFor || (routeKey !== null && !map.getSource(ROUTE_SRC))) { if (routeLayer()) routeDrawnFor = routeKey; }
    }
    map.on('styledata', () => { routeDrawnFor = undefined; });

    // ---- text that changes every second --------------------------------------------------------------------------
    function headline() {
      const s = snap, mine = me();
      if (s.status === 'replaced') return 'Open on another screen';
      if (s.status !== 'live') return s.unreachable ? 'Can\'t reach the convoy' : s.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
      let h = `${s.members.filter((m) => m.online).length} of ${s.members.length} live`;
      if (s.ctx.role !== 'leader') {
        const lp = client.positions.get(s.ctx.leaderKey);
        if (lp && mine) h += ` · leader ${C.gapText(C.gap(lp, mine))}`;
      } else if (mine) {
        const gaps = [...client.positions.values()].filter((p) => p.key !== s.ctx.you).map((p) => C.gap(p, mine)).filter(Boolean).sort((a, b) => a.meters - b.meters);
        if (gaps.length) h += ` · last car ${C.gapText(gaps[0])}`;           // the leader watches the one furthest back
      }
      return h;
    }
    function paintText() {
      if (!snap || !snap.id) return;
      if (live.headline) live.headline.textContent = headline();
      for (const n of live.left) n.textContent = C.leftText(snap.ctx && snap.ctx.expiresAtMs);   // P-28: how long, not a clock time
      const mine = me();
      if (live.regroup) live.regroup.textContent = client.regroup && mine ? `Regroup${client.regroup.note ? ' at ' + client.regroup.note : ''} · ${C.distText(C.haversineM(mine, client.regroup))}` : '';
      for (const [k, span] of live.gaps) {
        const p = client.positions.get(k);
        span.textContent = k === snap.ctx.you ? 'you' : p && mine ? C.gapText(C.gap(p, mine)) : '';
      }
    }

    // ---- structure: rebuilt only when it changes -----------------------------------------------------------------
    function structKey() {
      const s = snap;
      if (!s || !s.id) return JSON.stringify([s && s.status, store.get('sessionStorage', INVITE_KEY) !== '', asked.list.map((i) => i.id), driving()]);
      return JSON.stringify([s.id, s.status, s.unreachable, s.ctx && s.ctx.role, s.ctx && s.ctx.name, s.members.map((m) => [m.key, m.online, m.role, m.handle]),
                             !!client.route, !!client.regroup, undo && undo.id, !!getRoute(), driving()]);
    }
    // P-21: one line, a tap opens the convoy. Idle with an invite waiting, the line is the invite; in a drive the leader's
    // calls come under it in one scrolling row.
    function paintBar() {
      const s = snap, idle = !(s && s.id);
      const inv = idle && !driving() ? asked.list[0] || null : null, link = idle && !driving() && !inv ? store.get('sessionStorage', INVITE_KEY) : '';
      bar.classList.toggle('show', !idle || !!inv || !!link);
      live.headline = null; live.regroup = null;
      const line = (dot, name, text) => {
        const b = el('button', { type: 'button', className: 'cv-line' }, el('i', { className: dot }), el('b', { textContent: name }), text);
        b.addEventListener('click', open);
        return b;
      };
      if (idle) {
        if (!inv && !link) { bar.replaceChildren(); return; }
        const ln = line('ask', inv ? inv.name : 'Convoy link', el('span', { textContent: inv ? `${inv.from ? '@' + inv.from : 'A friend'} invited you` : 'Join it?' }));
        labelled(ln, inv ? `${inv.from ? '@' + inv.from : 'A friend'} invited you to the convoy ${inv.name}. Open it` : 'A convoy link. Open it');
        bar.replaceChildren(ln);
        return;
      }
      live.headline = el('span');
      const kids = [labelled(line(s.status === 'live' ? '' : 'off', s.ctx ? s.ctx.name : 'Convoy', live.headline), `Convoy ${s.ctx ? s.ctx.name : ''}. Open it`)];
      if (client.regroup) { live.regroup = el('div', { className: 'cv-regroup' }); kids.push(live.regroup); }
      if (s.status === 'replaced') kids.push(el('div', { className: 'cv-calls' }, btn('Use the convoy here', () => client.takeOver())));
      else if (isLeader() && driving()) {                              // calls are for the road: only in a drive
        const calls = el('div', { className: 'cv-calls' });
        if (undo) calls.append(btn(`Undo ${C.KINDS[undo.type]}`, undoCall, 'ink-btn cv-undo'));
        else for (const k of LEADER_CALLS) calls.append(labelled(btn(C.KINDS[k], () => callOut(k)), `Call ${C.KINDS[k]} to the convoy`));
        calls.append(btn(client.regroup ? 'Clear regroup' : 'Regroup here', () => {
          if (client.regroup) { if (!client.clearRegroup()) toast('Not connected to the convoy.'); }
          else if (!getFix()) toast('No GPS fix yet.');
          else if (!client.callRegroup(getFix())) toast('Not connected to the convoy.');
        }));
        kids.push(calls);
      }
      bar.replaceChildren(...kids);
    }
    function callOut(type) {
      const id = client.callHazard(type, getFix());
      if (!id) { toast('No GPS fix yet.'); return; }
      clearTimeout(undo && undo.timer);
      undo = { id, type, timer: setTimeout(() => { undo = null; paint(); }, UNDO_MS) };
      toast(client.status === 'live' ? `${C.KINDS[type]} called to the convoy.` : `${C.KINDS[type]} will go out when the convoy reconnects.`);
      paint();
    }
    function undoCall() {
      if (!undo) return;
      const r = client.retract(undo.id);
      clearTimeout(undo.timer); undo = null;
      toast(r === 'queued' ? 'Cancelling: it goes out as soon as the convoy reconnects.' : 'Call cancelled.');
      paint();
    }

    // ---- in-app invites (IDEAS S-22): no link to copy, no website ----------------------------------------------------
    // Invites wait on the server for a minute-ish poll while the page is open and you're not in a convoy; a new one toasts.
    const asked = { list: [], at: 0, busy: false, seen: new Set() };
    async function loadAsked(force = false) {
      if (asked.busy || (snap && snap.id) || (!force && Date.now() - asked.at < 55e3)) return;
      asked.busy = true;
      try {
        const r = await apiFetch('/api/convoy/invites', { method: 'GET' });
        const list = r.ok ? await r.json() : null;
        if (Array.isArray(list)) {
          const fresh = list.find((i) => !asked.seen.has(i.id));
          for (const i of list) asked.seen.add(i.id);
          const changed = JSON.stringify(list.map((i) => i.id)) !== JSON.stringify(asked.list.map((i) => i.id));
          asked.list = list;
          if (fresh) toast(`${fresh.from ? '@' + fresh.from : 'A friend'} invited you to a convoy: ${fresh.name}.`, { label: 'See it', ms: 10000, onClick: open });
          if (changed) { lastKey = null; paint(); }
        }
      } catch (_) { /* signed out or offline: try again next minute */ }
      finally { asked.at = Date.now(); asked.busy = false; }
    }
    setInterval(() => { if (!document.hidden) loadAsked(); }, 60e3);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAsked(); });
    setTimeout(() => loadAsked(true), 3000);

    // The leader's picker: accepted friends, then private crew-mates, by handle; the server re-checks each one.
    async function invitePeople(box) {
      box.replaceChildren(el('p', { className: 'note', textContent: 'Loading your friends…' }));
      const handles = new Set();
      try {
        const friends = await apiFetch('/api/friends', { method: 'GET' }).then((r) => (r.ok ? r.json() : []));
        for (const f of friends || []) if (f.status === 'accepted' && f.handle) handles.add(f.handle);
        const crews = await apiFetch('/api/crews', { method: 'GET' }).then((r) => (r.ok ? r.json() : []));
        for (const c of (crews || []).filter((c) => c.visibility !== 'public').slice(0, 10)) {
          const mem = await apiFetch(`/api/crews/${encodeURIComponent(c.id)}/members`, { method: 'GET' }).then((r) => (r.ok ? r.json() : []));
          for (const m of mem || []) if (m.handle && !m.mine) handles.add(m.handle);
        }
      } catch (_) { /* offline: the list says so below */ }
      const inConvoy = new Set((snap && snap.members || []).map((m) => m.handle));
      const picks = [...handles].filter((h) => !inConvoy.has(h)).sort();
      if (!picks.length) { box.replaceChildren(el('p', { className: 'note', textContent: 'No friends or crew-mates to invite yet. Add friends in People, or show the code.' })); return; }
      const chosen = new Set();
      const rows = picks.map((h) => {
        const b = el('button', { className: 'ink-btn', textContent: '@' + h });
        b.setAttribute('aria-pressed', 'false');
        b.onclick = () => { if (chosen.has(h)) chosen.delete(h); else if (chosen.size < 15) chosen.add(h); b.classList.toggle('on', chosen.has(h)); b.setAttribute('aria-pressed', String(chosen.has(h))); };
        return b;
      });
      box.replaceChildren(el('div', { className: 'row', style: 'flex-wrap:wrap' }, ...rows), el('div', { className: 'row' }, btn('Send invites', async () => {
        if (!chosen.size) { toast('Pick who to invite.'); return; }
        const r = await client.post(`/api/convoy/${encodeURIComponent(snap.id)}/invite-people`, { handles: [...chosen] });
        if (!r.ok) { toast(r.status === 429 ? 'That\'s a lot of invites. Wait for some to join.' : 'Couldn\'t send the invites. Try again.'); return; }
        toast(r.body.invited ? `Invited ${r.body.invited}. They'll see it in the app.` : 'Nobody new to invite.');
        box.replaceChildren();
      }, 'ink-btn solid'), btn('Cancel', () => box.replaceChildren(), 'linkbtn')));
    }

    // ---- the convoy sheet, and the panel on a crew drive's card -------------------------------------------------------
    const inviteUrl = (invite) => `${siteOrigin()}/?convoy=${encodeURIComponent(invite)}`;
    async function shareInvite(fresh = false) {
      const invite = await client.inviteLink(fresh);
      if (!invite) { toast('Couldn\'t make an invite. Try again.'); return; }
      copyText(inviteUrl(invite), 'Convoy link copied. It works for 30 minutes.', 'Join my convoy');
    }
    // A QR code of the link (IDEAS S-22): scanned with the phone camera in the car park, no copy and paste. The encoder
    // (vendor/qrcode.js, MIT, Kazuhiko Arase) loads only when asked; the code is drawn on a canvas, no markup from it.
    let qrLib = null;
    const loadQr = () => qrLib || (qrLib = new Promise((ok, fail) => {
      if (root.qrcode) { ok(root.qrcode); return; }
      const sc = document.createElement('script'); sc.src = 'vendor/qrcode.js';
      sc.onload = () => (root.qrcode ? ok(root.qrcode) : fail(new Error('qr'))); sc.onerror = () => { qrLib = null; fail(new Error('qr')); };
      document.head.append(sc);
    }));
    async function showQr(box) {
      const invite = await client.inviteLink(false);
      if (!invite) { toast('Couldn\'t make an invite. Try again.'); return; }
      let qrcode;
      try { qrcode = await loadQr(); } catch (_) { toast('Couldn\'t draw the code. Share the link instead.'); return; }
      const qr = qrcode(0, 'M'); qr.addData(inviteUrl(invite)); qr.make();
      const n = qr.getModuleCount(), cell = Math.max(4, Math.floor(232 / (n + 8))), size = (n + 8) * cell;
      const cv = el('canvas', { width: size, height: size, className: 'cv-qr' });
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Convoy QR code');
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
      box.replaceChildren(cv, el('p', { className: 'note', textContent: 'Point a phone camera at it to join. Works for 30 minutes.' }),
        btn('Hide', () => box.replaceChildren(), 'linkbtn'));
    }
    const preview = { invite: null, status: null, ok: false, body: null, at: 0 };
    async function loadPreview(invite) {
      Object.assign(preview, { invite, status: null, ok: false, body: null, at: Date.now() });
      const r = await client.post('/api/convoy/preview', { invite });
      if (preview.invite !== invite) return;
      Object.assign(preview, { status: r.status, ok: r.ok && !!(r.body && r.body.name), body: r.body, at: Date.now() });
      lastKey = null; paint();
    }
    // One host's content. The sheet ('sheet') holds everything: an invite or a link to answer, Convoy now when there is
    // none, and the live convoy. A drive card's panel ('card') only the live convoy: the card says the rest itself.
    function renderHost(h) {
      const s = snap, box = h.box, kids = [];
      if (!s || !s.id) {
        if (h.picker) h.picker.replaceChildren();                       // a convoy that ended takes its code and picker with it
        if (h.kind !== 'sheet') { box.replaceChildren(); return; }
        const pending = store.get('sessionStorage', INVITE_KEY);
        loadAsked();
        const at = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        for (const inv of asked.list) {
          kids.push(el('p', { className: 'note', textContent: `${inv.from ? '@' + inv.from : 'A friend'} invited you: ${inv.name} · until ${at(inv.expiresAtMs)}. Joining shares your position with the convoy.` }),
            el('div', { className: 'row' }, btn('Join', async () => {
              const r = await accept(inv);
              if (!r.ok) toast(r.status === 409 ? 'That convoy is full.' : r.status === 0 || r.status >= 500 ? 'No connection. Try again in a moment.' : 'That invite has run out. Ask for a new one.');
              else toast('You\'re in the convoy. Your position is shared with it until you leave.');
            }, 'ink-btn solid'), btn('Not now', () => dismiss(inv), 'linkbtn')));
        }
        if (pending) {
          // Say which convoy before the yes: joining shares your position with everyone in it.
          const pv = preview.invite === pending ? preview : null;
          if (!pv || (pv.status !== null && Date.now() - pv.at > 60e3)) loadPreview(pending);   // invites run out and convoys fill
          const lead = (l) => (l && l.handle ? '@' + l.handle : 'someone');
          kids.push(el('p', { className: 'note', textContent: !pv || !pv.status ? 'Checking the convoy link…'
            : pv.ok ? `${pv.body.name} · led by ${lead(pv.body.leader)} · ${pv.body.members} of ${pv.body.max} in · ${C.leftText(pv.body.expiresAtMs)}`
            : pv.status === 409 ? 'That convoy is full.'
            : pv.status === 0 || pv.status === 429 || pv.status >= 500 ? 'Couldn\'t check the convoy link. You can still try to join.'
            : 'That convoy link has run out or isn\'t yours to use. Ask the leader for a new one.' }));
          kids.push(el('div', { className: 'row' }, btn('Join the convoy', async () => {
            const r = await client.join(pending);
            if (r.ok || r.status === 400 || r.status === 403 || r.status === 404 || r.status === 409) store.set('sessionStorage', INVITE_KEY, '');
            if (!r.ok) toast(r.status === 403 ? 'That convoy link is no longer yours to use. Ask the leader for a new one.' : r.status === 409 ? 'That convoy is full.'
              : r.status === 0 || r.status >= 500 ? 'No connection. Try again in a moment.' : 'That convoy link didn\'t work. Ask the leader for a new one.');
            else toast('You\'re in the convoy. Your position is shared with it until you leave.');
            paint();
          }, 'ink-btn solid'), btn('Not now', () => { store.set('sessionStorage', INVITE_KEY, ''); preview.invite = null; lastKey = null; paint(); }, 'linkbtn')));
        } else if (!asked.list.length) {
          // Convoy now (P-11): drive together now, no crew needed; a crew's convoy starts from its drive's card
          const name = labelled(el('input', { className: 'field', placeholder: 'Convoy name', maxLength: 40, autocomplete: 'off', value: h.name || '' }), 'Convoy name');
          kids.push(el('p', { className: 'note', textContent: 'Drive together, live, for up to two hours. Friends join with the code or the link; a crew’s run starts its convoy from the drive’s card.' }),
            el('details', { className: 'how' }, el('summary', { textContent: 'How this works' }),
              el('p', { className: 'note', textContent: 'Everyone in the convoy sees where everyone is, the leader can call hazards and a regroup point, and the co-driver warns you before you get there. Nothing is kept: it ends when the leader leaves or after two hours.' })),
            el('div', { className: 'row' }, name, btn('Start a convoy', () => now(name.value.trim()), 'ink-btn solid')));
        }
        box.replaceChildren(...kids);
        return;
      }
      const c = s.ctx;
      // P-28: how long it has left, kept fresh every second, not the clock time it ends
      const left = el('span', { textContent: C.leftText(c.expiresAtMs) });
      live.left.push(left);
      kids.push(el('p', { className: 'note' }, document.createTextNode(`${h.kind === 'sheet' ? `${c.name} · ` : 'Convoy · '}you are ${c.role === 'leader' ? 'leading' : 'following'} · `), left));
      const list = el('div', { className: 'cv-members' });
      loadCars();
      for (const m of s.members) {
        const car = m.key !== c.you && m.handle ? cars.byHandle.get(m.handle) : null;
        const gap = el('span', { className: 'note' });
        live.gaps.push([m.key, gap]);
        const row = el('div', { className: 'cv-member' },
          el('span', {}, el('span', { className: 'cv-on' + (m.online || m.key === c.you ? ' live' : '') }), document.createTextNode(label(m) + (m.role === 'leader' ? ' · leader' : '')),
            ...(car ? [el('span', { className: 'cv-car', textContent: car })] : [])), gap);
        if (c.role === 'leader' && m.key !== c.you) row.append(btn('Remove', async () => { if (await ApexConfirm.ask(`Remove ${label(m)} from the convoy? They can't come back into it.`, 'Remove')) { if (!(await client.removeMember(m.key))) toast('Couldn\'t remove them. Try again.'); } }, 'linkbtn'));
        list.append(row);
      }
      kids.push(list);
      // the picker (invite friends, the QR code) is the host's own: a status change redraws around it, never wipes it
      const actions = el('div', { className: 'row', style: 'flex-wrap:wrap' }), picker = h.picker || (h.picker = el('div', { className: 'stack-8' }));
      if (c.role === 'leader') {
        actions.append(btn('Invite friends', () => invitePeople(picker), 'ink-btn solid'), btn('Show QR', () => showQr(picker)), btn('Share link', () => shareInvite(false)),
          btn('New link', async () => { if (await ApexConfirm.ask('Make a new link? The old one stops working for anyone who hasn\'t joined yet.', 'New link')) shareInvite(true); }, 'linkbtn'));
        const r = getRoute();
        const shareMsg = { sent: (n) => `${n} shared with the convoy.`, offline: () => 'Not connected to the convoy.', too_long: () => 'That route is too long to share.' };
        if (r) actions.append(btn(client.route ? 'Update shared route' : 'Share my route', () => { const out = client.shareRoute(r.name, r.pts); toast(shareMsg[out](r.name)); }));
        else if (client.route) actions.append(btn('Stop sharing route', () => { if (!client.clearRoute()) toast('Not connected to the convoy.'); }));
      }
      // from the map's sheet, the drive itself is one key away (a convoy started at the petrol station, then go)
      if (h.kind === 'sheet' && !driving() && page.drive) actions.append(btn('Start the drive', () => { close(); page.drive(); }, 'ink-btn'));
      actions.append(btn(c.role === 'leader' ? 'End convoy' : 'Leave', async () => {
        if (!(await ApexConfirm.ask(c.role === 'leader' ? 'End the convoy for everyone?' : 'Leave the convoy?', c.role === 'leader' ? 'End convoy' : 'Leave'))) return;
        await client.leave(); toast(c.role === 'leader' ? 'Convoy ended.' : 'You left the convoy.');
      }, 'linkbtn'));
      kids.push(actions);
      if (c.role === 'leader') kids.push(picker);
      if (s.status === 'replaced') kids.push(el('div', { className: 'row' }, el('span', { className: 'note', textContent: 'This convoy is open on another screen.' }), btn('Use it here', () => client.takeOver())));
      else if (s.status !== 'live') kids.push(el('p', { className: 'note', textContent: s.unreachable ? 'Can\'t reach the convoy. Still trying.' : s.status === 'reconnecting' ? 'No connection to the convoy. Retrying…' : 'Connecting…' }));
      box.replaceChildren(...kids);
      if (h.showQr && c.role === 'leader') { h.showQr = false; showQr(picker); }   // Convoy now: the code first, for the car park
    }
    function renderAll() {
      live.gaps = []; live.left = [];
      for (const h of [...hosts]) { if (h.kind !== 'sheet' && !h.box.isConnected && h.drawn) { hosts.delete(h); continue; } h.drawn = true; renderHost(h); }
    }
    // Daily cars come from the Garage's own list of people you know, so its rules hold here too: only a car its owner shows, only
    // to friends and private crew-mates, never across a block. Someone in the convoy you don't know simply has no car line.
    const cars = { byHandle: new Map(), at: 0, busy: false };
    function loadCars() {
      if (cars.busy || Date.now() - cars.at < 60e3) return;
      cars.busy = true;
      apiFetch('/api/garage/people').then((r) => (r.ok ? r.json() : null)).then((people) => {
        if (!Array.isArray(people)) return;
        const next = new Map();
        for (const p of people) {
          const c = p && p.handle && Array.isArray(p.cars) ? p.cars.find((x) => x.is_primary) : null;
          if (c) next.set(p.handle, [c.year, c.make, c.model].filter((x) => x != null && x !== '').join(' '));
        }
        const changed = JSON.stringify([...next]) !== JSON.stringify([...cars.byHandle]);
        cars.byHandle = next;
        if (changed) { lastKey = null; paint(); }
      }).catch(() => {}).finally(() => { cars.at = Date.now(); cars.busy = false; });
    }
    const STATUS_TOAST = { ended: 'The convoy has ended.', removed: 'The leader took you out of the convoy.', signed_out: 'Signed out, so you left the convoy.' };
    let lastStatus = 'off';
    function paint(what = 'structure') {
      if (snap && lastStatus !== snap.status) {
        if (STATUS_TOAST[snap.status] && lastStatus !== 'off') toast(STATUS_TOAST[snap.status]);
        // P-21: in a drive a lost link is a status-line message (the page's toast is the drive's message row), once
        else if (snap.status === 'reconnecting' && lastStatus === 'live' && driving()) toast('Convoy: reconnecting…');
        lastStatus = snap.status;
      }
      if (snap && !snap.id) spoken.clear();
      const key = structKey();
      if (what === 'structure' && key !== lastKey) { lastKey = key; renderAll(); paintBar(); tellWatchers(); }
      paintText(); paintMap();
    }

    // The convoy sheet over the map: from the line, an invite's toast, a convoy link, and Convoy now.
    let sheet = null;
    function open() {
      if (sheet && sheet.el.isConnected) return;
      const host = { box: el('div', { className: 'stack-8' }), kind: 'sheet' };
      const back = el('div', { className: 'overlay dim show convoy-sheet' });
      back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true'); back.setAttribute('aria-label', 'Convoy');
      back.append(el('div', { className: 'card-sheet' }, el('div', { className: 'cv-sheet-head' }, el('h2', { textContent: 'Convoy' }), btn('Done', close, 'linkbtn')), host.box));
      back.addEventListener('click', (e) => { if (e.target === back) close(); });
      const key = (e) => { if (e.key === 'Escape' && !(root.ApexConfirm && root.ApexConfirm.open)) close(); };
      document.addEventListener('keydown', key);
      sheet = { el: back, host, key };
      hosts.add(host);
      live.gaps = []; live.left = [];
      for (const h of hosts) renderHost(h);
      document.body.append(back);
      paintText();
      loadAsked(true);
      return host;
    }
    function close() {
      if (!sheet) return;
      sheet.el.remove(); hosts.delete(sheet.host); document.removeEventListener('keydown', sheet.key); sheet = null;
    }
    /** Convoy now (P-11): an ad-hoc convoy from the map, no crew; the sheet opens on its QR code for the car park. */
    async function now(name) {
      if (snap && snap.id) { open(); return { ok: false, status: 'busy' }; }
      const r = await client.start(String(name || '').slice(0, 40));
      if (!r.ok) {
        toast(r.status === 401 || r.status === 403 ? 'Sign in on People to drive in a convoy.' : r.status === 429 ? 'You already lead two convoys. End one first.' : 'Couldn\'t start a convoy. Check signal and try again.');
        return r;
      }
      const host = open() || (sheet && sheet.host);
      if (host) { host.showQr = true; lastKey = null; paint(); }
      return r;
    }
    async function accept(inv) {
      const r = await client.accept(inv.id);
      asked.list = asked.list.filter((x) => x.id !== inv.id);
      lastKey = null; paint();
      return r;
    }
    function dismiss(inv) {
      asked.list = asked.list.filter((x) => x.id !== inv.id); lastKey = null; paint();
      apiFetch(`/api/convoy/invites/${encodeURIComponent(inv.id)}`, { method: 'DELETE' }).catch(() => {});
    }

    // a link `/?convoy=<invite>`: keep it (not in the address bar) until the person says yes on the convoy sheet
    function takeInvite(fromLink) {
      store.set('sessionStorage', INVITE_KEY, fromLink);
      lastKey = null; paint();
      open();
    }
    try {
      const q = new URLSearchParams(location.search), fromLink = q.get('convoy');
      if (fromLink) {
        q.delete('convoy');
        history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
        setTimeout(() => takeInvite(fromLink), 0);   // after the page has drawn: the sheet goes over it
      }
    } catch (_) { /* no history API */ }
    let resumeTry = 0;
    const resume = () => {
      const id = store.get('localStorage', RESUME_KEY);
      if (!id || client.id) return;
      client.resume(id).then((r) => {
        if (r === 'gone') store.set('localStorage', RESUME_KEY, '');
        if (r === 'retry') setTimeout(resume, Math.min(60000, 2000 * 2 ** resumeTry++));   // no signal at the trailhead: keep trying
      });
    };
    resume();

    return {
      client,
      get active() { return !!(snap && snap.id); },
      /** The live convoy, for a drive's card: { name, role, status, members, expiresAtMs } or null. */
      state() { return snap && snap.id && snap.ctx ? { name: snap.ctx.name, role: snap.ctx.role, status: snap.status, members: snap.members.length, expiresAtMs: snap.ctx.expiresAtMs } : null; },
      /** In-app invites waiting ({ id, name, from, expiresAtMs }); a drive's card shows the one for its convoy. */
      invites() { loadAsked(); return asked.list.slice(); },
      accept, dismiss, open, close, now,
      /** The live convoy's panel for a drive's card (members, the leader's keys, the time left), redrawn in place. */
      panel() { const h = { box: el('div', { className: 'stack-8 cv-panel' }), kind: 'card' }; hosts.add(h); live.left = live.left || []; renderHost(h); paintText(); return h.box; },
      /** `fn()` after the convoy or its invites change, until it returns false (a card gone from the screen). */
      watch(fn) { watchers.add(fn); },
      /** A convoy link the app handed to the running page: waits for a yes on the convoy sheet, like one opened from the web. */
      takeInvite,
      /** A crew drive's convoy (IDEAS S-06): starts one named for it and invites the people going, in the app (no link).
       *  Resolves { ok, invited } or { ok: false, status } ('busy' when you're already in a convoy). */
      async startFor(name, handles) {
        if (snap && snap.id) return { ok: false, status: 'busy' };
        const r = await client.start(String(name || '').slice(0, 40));
        if (!r.ok) return { ok: false, status: r.status };
        const list = [...new Set(handles || [])].slice(0, 15);
        if (!list.length || !client.id) return { ok: true, invited: 0 };
        const inv = await client.post(`/api/convoy/${encodeURIComponent(client.id)}/invite-people`, { handles: list });
        return { ok: true, invited: inv.ok && inv.body ? inv.body.invited || 0 : 0 };
      },
    };
  }

  root.ApexConvoyUI = { mount };
})(window);
