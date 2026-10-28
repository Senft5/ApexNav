// Convoy on screen: the Crew sheet's Convoy section, the strip over the map, cars and hazards on the map, and the
// co-driver's hazard calls. The page hands in what it owns (map, position, voice, toasts) through mount(); the link and
// geometry live in convoy.js. Every name, handle and note is set as text, never as HTML.
(function (root) {
  const C = root.ApexConvoy;
  const RESUME_KEY = 'apex.convoy', INVITE_KEY = 'apex.convoyInvite', UNDO_MS = 3000, TICK_MS = 1000;
  const LEADER_CALLS = ['bump', 'gravel', 'debris', 'animal', 'police', 'stopped'];
  const store = {
    get: (s, k) => { try { return s.getItem(k) || ''; } catch (_) { return ''; } },
    set: (s, k, v) => { try { if (v) s.setItem(k, v); else s.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const CSS = `
    .convoy-bar { position: absolute; left: 10px; right: 10px; top: calc(76px + var(--safe-top, 0px)); z-index: 5; display: none; gap: 6px; flex-direction: column;
      background: var(--panel); color: var(--panel-ink); border: 1px solid var(--rule); padding: 8px 10px; font-size: 13px; max-width: 420px; }
    .convoy-bar.show { display: flex; }
    #app.sheet-open .convoy-bar { display: none; }
    .convoy-bar .cv-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 28px; }
    .convoy-bar .cv-head b { font-family: var(--font-num); }
    .convoy-bar .cv-calls { display: flex; flex-wrap: wrap; gap: 6px; }
    .convoy-bar .cv-calls button { min-height: 40px; min-width: 44px; padding: 0 10px; font-size: 13px; font-weight: 700; }
    .convoy-bar .cv-undo { color: var(--signal, #c33); border-color: var(--signal, #c33); }
    .convoy-dot { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--panel, #fff);
      background: var(--accent, #2a6); color: var(--panel, #fff); font: 800 11px var(--font-ui, sans-serif); box-shadow: 0 1px 4px rgba(0,0,0,.4); }
    .convoy-dot.leader { background: var(--panel-ink, #111); }
    .convoy-dot.stale { opacity: 0.45; }
    .convoy-pin { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; padding: 2px 5px; border: 1.5px solid var(--amber, #c80); color: var(--amber, #c80);
      background: var(--panel, #fff); white-space: nowrap; font-family: var(--font-ui, sans-serif); }
    .convoy-pin.regroup { border-color: var(--accent, #2a6); color: var(--accent, #2a6); }
    .cv-members { display: grid; gap: 4px; }
    .cv-member { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 40px; }
    .cv-member .cv-on { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--panel-dim); margin-right: 6px; }
    .cv-member .cv-on.live { background: var(--gain, #2a6); }
  `;

  function mount(page) {
    const { map, maplibregl, el, btn, toast, copyText, getFix, getRoute, speak, siteOrigin, wsUrl, apiFetch } = page;
    const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
    const bar = el('div', { className: 'convoy-bar', role: 'status' });
    (page.overlayParent || document.body).append(bar);

    let snap = null, undo = null, sectionHost = null, ownInvite = null;
    const spoken = new Map();                                   // eventId -> 'far' | 'near': each hazard is called at most twice
    const markers = { cars: new Map(), hazards: new Map(), regroup: null };

    const client = new C.ConvoyClient({
      apiFetch, wsUrl,
      onChange: (s) => { snap = s; if (s.id) store.set(localStorage, RESUME_KEY, s.id); else store.set(localStorage, RESUME_KEY, ''); paint(); },
      onHazard: () => tick(),
      onRetract: (ev) => { if (spoken.has(ev.eventId)) toast(`${C.KINDS[ev.type] || 'Hazard'} call cancelled by the leader.`); spoken.delete(ev.eventId); paint(); },
    });

    const me = () => client.locate(getFix());
    const isLeader = () => !!(snap && snap.ctx && snap.ctx.role === 'leader');
    const label = (m) => (m && (m.handle ? '@' + m.handle : m.name)) || 'Driver';
    const initial = (m) => ((m && (m.handle || m.name)) || '?').slice(0, 1).toUpperCase();

    // ---- every second: send my position, call hazards that are ahead of me, move the markers --------------------
    function tick() {
      if (!snap || !snap.id) return;
      const fix = getFix();
      if (fix) client.sendPosition(fix);
      const mine = me(), version = client.route ? client.route.version : null;
      for (const ev of client.liveHazards()) {
        if (snap.ctx && ev.leaderKey === snap.ctx.you) continue;            // my own call
        const ahead = C.hazardAhead(ev, mine, version), was = spoken.get(ev.eventId);
        if (ahead == null) continue;
        if (!was) { spoken.set(ev.eventId, ahead < 200 ? 'near' : 'far'); speak(C.hazardPhrase(ev.type, ahead)); }
        else if (was === 'far' && ahead < 200) { spoken.set(ev.eventId, 'near'); speak(C.hazardPhrase(ev.type, ahead)); }
      }
      paintMap(); paintBar();
    }
    setInterval(tick, TICK_MS);

    // ---- map ----------------------------------------------------------------------------------------------------
    const ROUTE_SRC = 'apex-convoy-route';
    function routeLayer() {
      if (!map.isStyleLoaded || !map.isStyleLoaded()) return;
      const fc = { type: 'FeatureCollection', features: client.routeIdx ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: client.routeIdx.pts.map(([la, lo]) => [lo, la]) } }] : [] };
      try {
        if (!map.getSource(ROUTE_SRC)) {
          map.addSource(ROUTE_SRC, { type: 'geojson', data: fc });
          map.addLayer({ id: ROUTE_SRC, type: 'line', source: ROUTE_SRC, paint: { 'line-color': '#7a5cff', 'line-width': 4, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] } });
        } else map.getSource(ROUTE_SRC).setData(fc);
      } catch (_) { /* style swapping: next tick */ }
    }
    let routeDrawnFor = null;
    function paintMap() {
      const want = snap && snap.id ? snap : null, t = Date.now();
      // cars (not me: the puck is me)
      const cars = new Map(want ? [...want.positions].filter(([k]) => k !== want.ctx.you) : []);
      for (const [k, m] of markers.cars) if (!cars.has(k)) { m.remove(); markers.cars.delete(k); }
      for (const [k, p] of cars) {
        const who = client.members.get(k);
        let m = markers.cars.get(k);
        if (!m) {
          const dot = el('div', { className: 'convoy-dot' });
          m = new maplibregl.Marker({ element: dot }).setLngLat([p.lon, p.lat]).addTo(map);
          markers.cars.set(k, m);
        }
        const dot = m.getElement();
        dot.textContent = initial(who);
        dot.className = 'convoy-dot' + (who && who.role === 'leader' ? ' leader' : '') + (t - p.at > 15000 ? ' stale' : '');
        dot.title = label(who);
        dot.setAttribute('aria-label', `${label(who)}${who && who.role === 'leader' ? ', leader' : ''}`);
        m.setLngLat([p.lon, p.lat]);
      }
      // hazards
      const hz = new Map(want ? client.liveHazards().map((e) => [e.eventId, e]) : []);
      for (const [k, m] of markers.hazards) if (!hz.has(k)) { m.remove(); markers.hazards.delete(k); }
      for (const [k, e] of hz) {
        if (markers.hazards.has(k) || !e.anchor) continue;
        const pin = el('div', { className: 'convoy-pin', textContent: (C.KINDS[e.type] || 'Hazard').toUpperCase() });
        markers.hazards.set(k, new maplibregl.Marker({ element: pin }).setLngLat([e.anchor.lon, e.anchor.lat]).addTo(map));
      }
      // regroup point
      const rg = want && want.regroup;
      if (!rg && markers.regroup) { markers.regroup.remove(); markers.regroup = null; }
      if (rg) {
        if (!markers.regroup) markers.regroup = new maplibregl.Marker({ element: el('div', { className: 'convoy-pin regroup' }) }).addTo(map);
        markers.regroup.getElement().textContent = 'REGROUP' + (rg.note ? ` · ${rg.note}` : '');
        markers.regroup.setLngLat([rg.lon, rg.lat]);
      }
      const routeKey = want && client.route ? client.route.version : null;
      if (routeKey !== routeDrawnFor || (want && client.route && !map.getSource(ROUTE_SRC))) { routeLayer(); routeDrawnFor = routeKey; }
    }
    map.on('styledata', () => { routeDrawnFor = undefined; });

    // ---- the strip over the map ---------------------------------------------------------------------------------
    function paintBar() {
      const s = snap;
      bar.classList.toggle('show', !!(s && s.id));
      if (!s || !s.id) { bar.replaceChildren(); return; }
      const live = s.members.filter((m) => m.online).length;
      const mine = me();
      let headline = s.status === 'live' ? `${live} of ${s.members.length} live` : s.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
      if (s.ctx && s.ctx.role !== 'leader') {
        const lp = s.positions.get(s.ctx.leaderKey);
        if (lp && mine) headline += ` · leader ${C.gapText(C.gap(lp, mine))}`;
      } else if (mine) {
        // the leader sees the last car: the one furthest behind
        const others = [...s.positions.values()].filter((p) => p.key !== s.ctx.you);
        const gaps = others.map((p) => C.gap(p, mine)).filter(Boolean).sort((a, b) => a.meters - b.meters);
        if (gaps.length) headline += ` · last car ${C.gapText(gaps[0])}`;
      }
      const head = el('div', { className: 'cv-head' }, el('b', { textContent: s.ctx ? s.ctx.name : 'Convoy' }), el('span', { textContent: headline }));
      const kids = [head];
      if (s.regroup && mine) kids.push(el('div', { textContent: `Regroup${s.regroup.note ? ' at ' + s.regroup.note : ''} · ${C.distText(C.haversineM(mine, s.regroup))}` }));
      if (isLeader()) {
        const calls = el('div', { className: 'cv-calls' });
        if (undo) calls.append(btn(`Undo ${C.KINDS[undo.type]}`, () => { client.retract(undo.id); clearTimeout(undo.timer); undo = null; toast('Call cancelled.'); paintBar(); }, 'ink-btn cv-undo'));
        else for (const k of LEADER_CALLS) calls.append(btn(C.KINDS[k], () => callOut(k)));
        calls.append(btn(s.regroup ? 'Clear regroup' : 'Regroup here', () => {
          if (s.regroup) client.clearRegroup(); else if (!client.callRegroup(getFix())) toast('No GPS fix yet.');
        }));
        kids.push(calls);
      }
      bar.replaceChildren(...kids);
    }
    function callOut(type) {
      const id = client.callHazard(type, getFix());
      if (!id) { toast('No GPS fix yet.'); return; }
      clearTimeout(undo && undo.timer);
      undo = { id, type, timer: setTimeout(() => { undo = null; paintBar(); }, UNDO_MS) };
      toast(`${C.KINDS[type]} called to the convoy.`);
      paintBar();
    }

    // ---- the Crew sheet's Convoy section ------------------------------------------------------------------------
    function inviteUrl(invite) { return `${siteOrigin()}/?convoy=${encodeURIComponent(invite)}`; }
    async function shareInvite() {
      const invite = ownInvite || client.invite || (await client.newInvite());
      if (!invite) { toast('Couldn\'t make an invite. Try again.'); return; }
      ownInvite = null; client.invite = null;                     // invites last 30 minutes: make a fresh one next time
      copyText(inviteUrl(invite), 'Convoy link copied. It works for 30 minutes.', 'Join my convoy');
    }
    function renderSection() {
      const s = snap, box = sectionHost;
      if (!box) return;
      const kids = [el('h3', { textContent: 'Convoy' })];
      const pending = store.get(sessionStorage, INVITE_KEY);
      if (!s || !s.id) {
        const consent = el('p', { className: 'note', textContent: 'Drive together live: everyone in the convoy sees where everyone is, the leader can call hazards and a regroup point, and the co-driver warns you before you get there. Nothing is kept: it ends when the leader leaves or after two hours.' });
        kids.push(consent);
        if (pending) {
          kids.push(el('div', { className: 'row' }, btn('Join the convoy', async () => {
            const r = await client.join(pending);
            store.set(sessionStorage, INVITE_KEY, '');
            if (!r.ok) toast(r.status === 403 ? 'That convoy link is no longer yours to use. Ask the leader for a new one.' : r.status === 409 ? 'That convoy is full.' : 'That convoy link didn\'t work. Ask the leader for a new one.');
            else toast('You\'re in the convoy. Your position is shared with it until you leave.');
          }, 'ink-btn solid'), btn('Not now', () => { store.set(sessionStorage, INVITE_KEY, ''); renderSection(); }, 'linkbtn')));
        } else {
          const name = el('input', { className: 'field', placeholder: 'Convoy name (optional)', maxLength: 40, autocomplete: 'off', 'aria-label': 'Convoy name' });
          kids.push(el('div', { className: 'row' }, name, btn('Start a convoy', async () => {
            const r = await client.start(name.value.trim());
            if (!r.ok) { toast('Couldn\'t start a convoy. Check signal and try again.'); return; }
            ownInvite = client.invite; shareInvite();
          }, 'ink-btn solid')));
        }
      } else {
        const c = s.ctx;
        kids.push(el('p', { className: 'note', textContent: `${c.name} · you are ${c.role === 'leader' ? 'leading' : 'following'} · ends ${new Date(c.expiresAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }));
        const list = el('div', { className: 'cv-members' }), mine = me();
        for (const m of s.members) {
          const p = s.positions.get(m.key), g = m.key !== c.you && p && mine ? C.gapText(C.gap(p, mine)) : m.key === c.you ? 'you' : '';
          const row = el('div', { className: 'cv-member' },
            el('span', {}, el('span', { className: 'cv-on' + (m.online || m.key === c.you ? ' live' : '') }), document.createTextNode(label(m) + (m.role === 'leader' ? ' · leader' : ''))),
            el('span', { className: 'note', textContent: g }));
          if (c.role === 'leader' && m.key !== c.you) row.append(btn('Remove', async () => { if (confirm(`Remove ${label(m)} from the convoy?`)) { if (!(await client.removeMember(m.key))) toast('Couldn\'t remove them. Try again.'); } }, 'linkbtn'));
          list.append(row);
        }
        kids.push(list);
        const actions = el('div', { className: 'row' });
        if (c.role === 'leader') {
          actions.append(btn('Invite', shareInvite));
          const r = getRoute();
          if (r) actions.append(btn(client.route ? 'Update shared route' : 'Share my route', () => { toast(client.shareRoute(r.name, r.pts) ? `${r.name} shared with the convoy.` : 'That route is too long to share.'); }));
          else if (client.route) actions.append(btn('Stop sharing route', () => client.clearRoute()));
        }
        actions.append(btn(c.role === 'leader' ? 'End convoy' : 'Leave', async () => {
          if (!confirm(c.role === 'leader' ? 'End the convoy for everyone?' : 'Leave the convoy?')) return;
          await client.leave(); toast(c.role === 'leader' ? 'Convoy ended.' : 'You left the convoy.');
        }, c.role === 'leader' ? 'ink-btn' : 'linkbtn'));
        kids.push(actions);
        if (s.status !== 'live') kids.push(el('p', { className: 'note', textContent: s.status === 'reconnecting' ? 'No connection to the convoy. Retrying…' : 'Connecting…' }));
      }
      box.replaceChildren(...kids);
    }
    let lastStatus = 'off';
    function paint() {
      if (snap && lastStatus !== snap.status) {
        if (snap.status === 'ended' && lastStatus !== 'off') toast('The convoy has ended.');
        if (snap.status === 'removed') toast('The leader took you out of the convoy.');
        lastStatus = snap.status;
      }
      if (snap && !snap.id) spoken.clear();
      renderSection(); paintBar(); paintMap();
    }

    // a link `/?convoy=<invite>`: keep it until the person says yes in the Crew sheet
    const fromLink = new URLSearchParams(location.search).get('convoy');
    if (fromLink) { store.set(sessionStorage, INVITE_KEY, fromLink); if (page.showView) page.showView('crew'); }
    const resumeId = store.get(localStorage, RESUME_KEY);
    if (resumeId) client.resume(resumeId).then((ok) => { if (!ok) store.set(localStorage, RESUME_KEY, ''); });

    return {
      client,
      /** The Convoy section for the Crew sheet (re-rendered in place as the convoy changes). */
      section() { sectionHost = el('div', { className: 'stack-8' }); renderSection(); return sectionHost; },
      get active() { return !!(snap && snap.id); },
    };
  }

  root.ApexConvoyUI = { mount };
})(window);
