// Convoy on screen: the Crew sheet's Convoy section, the strip over the map, cars and hazards on the map, and the
// co-driver's hazard calls. The page hands in what it owns (map, position, voice, toasts) through mount(); the link and
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
    .convoy-bar { position: absolute; left: 10px; right: 10px; top: calc(76px + var(--safe-top, 0px)); z-index: 5; display: none; gap: 6px; flex-direction: column;
      background: var(--panel); color: var(--panel-ink); border: 1px solid var(--rule); padding: 8px 10px; font-size: 13px; max-width: 420px; }
    .convoy-bar.show { display: flex; }
    #app.sheet-open .convoy-bar { display: none; }
    .convoy-bar .cv-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 28px; }
    .convoy-bar .cv-head b { font-family: var(--font-num); }
    .convoy-bar .cv-calls { display: flex; flex-wrap: wrap; gap: 6px; }
    .convoy-bar .cv-calls button { min-height: 44px; min-width: 44px; padding: 0 10px; font-size: 13px; font-weight: 700; }
    .convoy-bar .cv-undo { color: var(--signal, #c33); border-color: var(--signal, #c33); }
    .convoy-dot { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--panel, #fff);
      background: var(--accent, #2a6); color: var(--panel, #fff); font: 800 11px var(--font-ui, sans-serif); box-shadow: 0 1px 4px rgba(0,0,0,.4); }
    .convoy-dot.leader { background: var(--panel-ink, #111); }
    .convoy-dot.stale { opacity: 0.45; }
    .convoy-pin { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; padding: 2px 5px; border: 1.5px solid var(--amber, #c80); color: var(--amber, #c80);
      background: var(--panel, #fff); white-space: nowrap; font-family: var(--font-ui, sans-serif); }
    .convoy-pin.regroup { border-color: var(--gain, #2a6); color: var(--gain, #2a6); }
    .cv-members { display: grid; gap: 4px; }
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

    let snap = null, undo = null, sectionHost = null, lastKey = null;
    const spoken = new Map();                                   // eventId -> 'far' | 'near': each hazard is called at most twice
    const markers = { cars: new Map(), hazards: new Map(), regroup: null };
    const live = { headline: null, regroup: null, gaps: new Map() };   // text nodes updated in place

    const client = new C.ConvoyClient({
      apiFetch, wsUrl,
      onChange: (s, what) => { snap = s; store.set('localStorage', RESUME_KEY, s.id || ''); paint(what); },
      onHazard: () => tick(),
      onRetract: (ev) => { if (spoken.has(ev.eventId)) toast(`${C.KINDS[ev.type] || 'Hazard'} call cancelled by the leader.`); spoken.delete(ev.eventId); paintMap(); },
      onError: (code) => toast(ERRORS[code] || 'The convoy refused that.'),
    });

    const me = () => client.locate(getFix());
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
      if (!s || !s.id) return JSON.stringify([s && s.status, store.get('sessionStorage', INVITE_KEY) !== '']);
      return JSON.stringify([s.id, s.status, s.unreachable, s.ctx && s.ctx.role, s.ctx && s.ctx.name, s.members.map((m) => [m.key, m.online, m.role, m.handle]),
                             !!client.route, !!client.regroup, undo && undo.id, !!getRoute()]);
    }
    function paintBar() {
      const s = snap;
      bar.classList.toggle('show', !!(s && s.id));
      live.headline = null; live.regroup = null;
      if (!s || !s.id) { bar.replaceChildren(); return; }
      live.headline = el('span');
      live.regroup = el('div');
      const kids = [el('div', { className: 'cv-head' }, el('b', { textContent: s.ctx ? s.ctx.name : 'Convoy' }), live.headline), live.regroup];
      if (s.status === 'replaced') kids.push(el('div', { className: 'cv-calls' }, btn('Use the convoy here', () => client.takeOver())));
      else if (isLeader()) {
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
          if (fresh) toast(`${fresh.from ? '@' + fresh.from : 'A friend'} invited you to a convoy: ${fresh.name}.`, { label: 'See it', ms: 10000, onClick: () => page.showView && page.showView('crew') });
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
      if (!picks.length) { box.replaceChildren(el('p', { className: 'note', textContent: 'No friends or crew-mates to invite yet. Add friends in Crew, or share the link.' })); return; }
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

    // ---- the Crew sheet's Convoy section ------------------------------------------------------------------------
    const inviteUrl = (invite) => `${siteOrigin()}/?convoy=${encodeURIComponent(invite)}`;
    async function shareInvite(fresh = false) {
      const invite = await client.inviteLink(fresh);
      if (!invite) { toast('Couldn\'t make an invite. Try again.'); return; }
      copyText(inviteUrl(invite), 'Convoy link copied. It works for 30 minutes.', 'Join my convoy');
    }
    const preview = { invite: null, status: null, ok: false, body: null, at: 0 };
    async function loadPreview(invite) {
      Object.assign(preview, { invite, status: null, ok: false, body: null, at: Date.now() });
      const r = await client.post('/api/convoy/preview', { invite });
      if (preview.invite !== invite) return;
      Object.assign(preview, { status: r.status, ok: r.ok && !!(r.body && r.body.name), body: r.body, at: Date.now() });
      lastKey = null; paint();
    }
    function renderSection() {
      const s = snap, box = sectionHost;
      if (!box) return;
      live.gaps.clear();
      const kids = [el('h3', { textContent: 'Convoy' })];
      const pending = store.get('sessionStorage', INVITE_KEY);
      if (!s || !s.id) {
        kids.push(el('p', { className: 'note', textContent: 'Drive together live: everyone in the convoy sees where everyone is, the leader can call hazards and a regroup point, and the co-driver warns you before you get there. Nothing is kept: it ends when the leader leaves or after two hours.' }));
        loadAsked();
        const at = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        for (const inv of asked.list) {
          kids.push(el('p', { className: 'note', textContent: `${inv.from ? '@' + inv.from : 'A friend'} invited you: ${inv.name} · until ${at(inv.expiresAtMs)}. Joining shares your position with the convoy.` }),
            el('div', { className: 'row' }, btn('Join', async () => {
              const r = await client.accept(inv.id);
              asked.list = asked.list.filter((x) => x.id !== inv.id);
              if (!r.ok) toast(r.status === 409 ? 'That convoy is full.' : r.status === 0 || r.status >= 500 ? 'No connection. Try again in a moment.' : 'That invite has run out. Ask for a new one.');
              else toast('You\'re in the convoy. Your position is shared with it until you leave.');
              lastKey = null; paint();
            }, 'ink-btn solid'), btn('Not now', async () => {
              asked.list = asked.list.filter((x) => x.id !== inv.id); lastKey = null; paint();
              apiFetch(`/api/convoy/invites/${encodeURIComponent(inv.id)}`, { method: 'DELETE' }).catch(() => {});
            }, 'linkbtn')));
        }
        if (pending) {
          // Say which convoy before the yes: joining shares your position with everyone in it.
          const pv = preview.invite === pending ? preview : null;
          if (!pv || (pv.status !== null && Date.now() - pv.at > 60e3)) loadPreview(pending);   // invites run out and convoys fill
          const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const lead = (l) => (l && l.handle ? '@' + l.handle : 'someone');
          kids.push(el('p', { className: 'note', textContent: !pv || !pv.status ? 'Checking the convoy link…'
            : pv.ok ? `${pv.body.name} · led by ${lead(pv.body.leader)} · ${pv.body.members} of ${pv.body.max} in · ends ${time(pv.body.expiresAtMs)}`
            : pv.status === 409 ? 'That convoy is full.'
            : pv.status === 0 || pv.status === 429 || pv.status >= 500 ? 'Couldn\'t check the convoy link. You can still try to join.'
            : 'That convoy link has run out or isn\'t yours to use. Ask the leader for a new one.' }));
        }
        if (pending) {
          kids.push(el('div', { className: 'row' }, btn('Join the convoy', async () => {
            const r = await client.join(pending);
            if (r.ok || r.status === 400 || r.status === 403 || r.status === 404 || r.status === 409) store.set('sessionStorage', INVITE_KEY, '');
            if (!r.ok) toast(r.status === 403 ? 'That convoy link is no longer yours to use. Ask the leader for a new one.' : r.status === 409 ? 'That convoy is full.'
              : r.status === 0 || r.status >= 500 ? 'No connection. Try again in a moment.' : 'That convoy link didn\'t work. Ask the leader for a new one.');
            else toast('You\'re in the convoy. Your position is shared with it until you leave.');
            paint();
          }, 'ink-btn solid'), btn('Not now', () => { store.set('sessionStorage', INVITE_KEY, ''); preview.invite = null; paint(); }, 'linkbtn')));
        } else {
          const name = labelled(el('input', { className: 'field', placeholder: 'Convoy name (optional)', maxLength: 40, autocomplete: 'off' }), 'Convoy name');
          kids.push(el('div', { className: 'row' }, name, btn('Start a convoy', async () => {
            const r = await client.start(name.value.trim());
            if (!r.ok) { toast(r.status === 429 ? 'You already lead two convoys. End one first.' : 'Couldn\'t start a convoy. Check signal and try again.'); return; }
            shareInvite();
          }, 'ink-btn solid')));
        }
      } else {
        const c = s.ctx;
        kids.push(el('p', { className: 'note', textContent: `${c.name} · you are ${c.role === 'leader' ? 'leading' : 'following'} · ends ${new Date(c.expiresAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }));
        const list = el('div', { className: 'cv-members' });
        loadCars();
        for (const m of s.members) {
          const car = m.key !== c.you && m.handle ? cars.byHandle.get(m.handle) : null;
          const gap = el('span', { className: 'note' });
          live.gaps.set(m.key, gap);
          const row = el('div', { className: 'cv-member' },
            el('span', {}, el('span', { className: 'cv-on' + (m.online || m.key === c.you ? ' live' : '') }), document.createTextNode(label(m) + (m.role === 'leader' ? ' · leader' : '')),
              ...(car ? [el('span', { className: 'cv-car', textContent: car })] : [])), gap);
          if (c.role === 'leader' && m.key !== c.you) row.append(btn('Remove', async () => { if (confirm(`Remove ${label(m)} from the convoy? They can't come back into it.`)) { if (!(await client.removeMember(m.key))) toast('Couldn\'t remove them. Try again.'); } }, 'linkbtn'));
          list.append(row);
        }
        kids.push(list);
        const actions = el('div', { className: 'row' }), picker = el('div', { className: 'stack-8' });
        if (c.role === 'leader') {
          actions.append(btn('Invite friends', () => invitePeople(picker), 'ink-btn solid'), btn('Share link', () => shareInvite(false)),
            btn('New link', () => { if (confirm('Make a new link? The old one stops working for anyone who hasn\'t joined yet.')) shareInvite(true); }, 'linkbtn'));
          const r = getRoute();
          const shareMsg = { sent: (n) => `${n} shared with the convoy.`, offline: () => 'Not connected to the convoy.', too_long: () => 'That route is too long to share.' };
          if (r) actions.append(btn(client.route ? 'Update shared route' : 'Share my route', () => { const out = client.shareRoute(r.name, r.pts); toast(shareMsg[out](r.name)); }));
          else if (client.route) actions.append(btn('Stop sharing route', () => { if (!client.clearRoute()) toast('Not connected to the convoy.'); }));
        }
        actions.append(btn(c.role === 'leader' ? 'End convoy' : 'Leave', async () => {
          if (!confirm(c.role === 'leader' ? 'End the convoy for everyone?' : 'Leave the convoy?')) return;
          await client.leave(); toast(c.role === 'leader' ? 'Convoy ended.' : 'You left the convoy.');
        }, c.role === 'leader' ? 'ink-btn' : 'linkbtn'));
        kids.push(actions);
        if (c.role === 'leader') kids.push(picker);
        if (s.status === 'replaced') kids.push(el('div', { className: 'row' }, el('span', { className: 'note', textContent: 'This convoy is open on another screen.' }), btn('Use it here', () => client.takeOver())));
        else if (s.status !== 'live') kids.push(el('p', { className: 'note', textContent: s.unreachable ? 'Can\'t reach the convoy. Still trying.' : s.status === 'reconnecting' ? 'No connection to the convoy. Retrying…' : 'Connecting…' }));
      }
      box.replaceChildren(...kids);
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
        lastStatus = snap.status;
      }
      if (snap && !snap.id) spoken.clear();
      const key = structKey();
      if (what === 'structure' && key !== lastKey) { lastKey = key; renderSection(); paintBar(); }
      paintText(); paintMap();
    }

    // a link `/?convoy=<invite>`: keep it (not in the address bar) until the person says yes in the Crew sheet
    function takeInvite(fromLink) {
      store.set('sessionStorage', INVITE_KEY, fromLink);
      if (sectionHost) { lastKey = null; paint(); }
      if (page.showView) page.showView('crew');
    }
    try {
      const q = new URLSearchParams(location.search), fromLink = q.get('convoy');
      if (fromLink) {
        q.delete('convoy');
        history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
        takeInvite(fromLink);
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
      /** The Convoy section for the Crew sheet (re-rendered in place as the convoy changes). */
      section() { sectionHost = el('div', { className: 'stack-8' }); renderSection(); paintText(); return sectionHost; },
      get active() { return !!(snap && snap.id); },
      /** A convoy link the app handed to the running page: waits for a yes in the Crew sheet, like one opened from the web. */
      takeInvite,
    };
  }

  root.ApexConvoyUI = { mount };
})(window);
