// Convoy on screen: the one line on the map, the convoy sheet it opens, the panel a crew drive's card shows while its
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
       Now one line (name and status) off the right-hand keys; the calls come only in a drive (below). */
    .convoy-bar.show { display: flex; }
    #app.sheet-open .convoy-bar { display: none; }
    /* @fish5spd, 2026-11-03 ("in my way when I lead"): in a drive the bar sat over the road just ahead of the arrow (the
       stage's top plus the safe area again, under the notes strip) with the leader's calls in a row cut off at the Layers
       key. Now the convoy is one line in the map's bottom-left corner, behind the car and clear of the right-hand keys; the
       calls come when the leader asks (the Report key's sheet, or a tap on the line) and go with the sheet. */
    .convoy-bar .cv-line .cv-rg { color: var(--panel-ink); }
    .convoy-bar .cv-key { flex: none; min-height: 36px; padding: 0 10px; font: 700 13px var(--font-ui, sans-serif); white-space: nowrap; }
    /* voice: one big key, thumb-sized for a car mount; green while your microphone is open, the accent when muted */
    .convoy-bar:has(> .cv-talk) { flex-direction: row; align-items: center; gap: 0; }
    .convoy-bar .cv-talk { flex: none; min-width: 84px; min-height: 48px; margin: 4px; font-size: 15px; }
    .convoy-bar .cv-talk.on { background: var(--gain, #2a6); border-color: var(--gain, #2a6); color: #fff; }
    .convoy-bar .cv-talk.muted { color: var(--accent); border-color: var(--accent); }
    .convoy-bar .cv-line .cv-talking { color: var(--gain, #2a6); font-weight: 700; }
    .convoy-bar .cv-undo { color: var(--signal, #c33); border-color: var(--signal, #c33); }
    #app.live .convoy-bar { top: auto; bottom: 10px; left: 10px; right: auto; max-width: min(360px, calc(100% - 90px)); flex-direction: row; align-items: center; gap: 0;
      border: 1.5px solid var(--panel-ink); box-shadow: 0 2px 0 var(--rule); }
    #app.live .convoy-bar .cv-line { flex: 1 1 auto; }
    .convoy-bar .cv-faces { display: none; }
    /* a calm drive: a pill of your friends' faces behind the car; the name and the count are read, not shown, while live */
    #app.live .convoy-bar { border-radius: 999px; overflow: hidden; }
    #app.live .convoy-bar .cv-line { min-height: 44px; padding: 0 14px 0 10px; }
    #app.live .convoy-bar .cv-faces { display: flex; flex: none; }
    #app.live .convoy-bar .cv-faces b { width: 26px; height: 26px; margin-left: -7px; border-radius: 50%; border: 2px solid var(--panel); background: var(--panel-ink); color: var(--panel);
      font: 800 13px/22px var(--font-num); text-align: center; overflow: visible; }
    #app.live .convoy-bar .cv-faces b:first-child { margin-left: 0; }
    #app.live .convoy-bar .cv-faces b.more { background: var(--panel-dim); }
    #app.live .convoy-bar .cv-line > b, #app.live .convoy-bar .cv-line.ok > span:not(.cv-faces):not(.cv-talking):not(.cv-rg) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    #app.live .convoy-bar .cv-line.ok::after { content: "Convoy"; font-weight: 700; }
    #app.live .stage:has(> .convoy-bar.show) > .plates { bottom: 82px; }   /* a Pro trial's line, if any, goes over the convoy's */
    @media (orientation: landscape) and (max-height: 540px) {
      #app.live .convoy-bar { left: calc(10px + var(--safe-left)); bottom: calc(10px + var(--safe-bottom)); max-width: min(360px, calc(100% - 90px - var(--safe-left) - var(--safe-right))); }
      /* the Report sheet on its side: the convoy's calls beside the public report, so both fit without a scroll */
      #hzOverlay .card-sheet:has(> .cv-report) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 24px; align-items: start; }
      #hzOverlay .card-sheet:has(> .cv-report) > .cv-report { grid-column: 1; grid-row: 1 / span 9; }
      #hzOverlay .card-sheet:has(> .cv-report) > :not(.cv-report) { grid-column: 2; }
      #hzOverlay .card-sheet:has(> .cv-report) .hz-grid { gap: 8px; }
      #hzOverlay .card-sheet:has(> .cv-report) .hz-grid button { font-size: 17px; padding: 0 8px; }
      #hzOverlay .card-sheet:has(> .cv-report) .hz-grid .hz-btn::before { display: none; }   /* the half-width keys keep their words whole */
    }
    .cv-callbox h3 { margin: 0; }
    .cv-callbox .note { margin: 2px 0 0; }
    .convoy-dot { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--panel, #fff);
      background: var(--accent, #2a6); color: var(--panel, #fff); font: 800 11px var(--font-ui, sans-serif); box-shadow: 0 1px 4px rgba(0,0,0,.4); }
    .convoy-dot.leader { background: var(--panel-ink, #111); }
    .convoy-dot.stale { opacity: 0.45; }
    .convoy-pin { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; padding: 2px 5px; border: 1.5px solid var(--amber, #c80); color: var(--amber, #c80);
      background: var(--panel, #fff); white-space: nowrap; font-family: var(--font-ui, sans-serif); }
    .convoy-pin.regroup { border-color: var(--gain, #2a6); color: var(--gain, #2a6); }
    .cv-members { display: grid; gap: 4px; }
    .cv-qr { width: 232px; height: 232px; image-rendering: pixelated; border-radius: 8px; }
    .cv-code { font: 600 22px/1.2 ui-monospace, Menlo, monospace; letter-spacing: 0.12em; margin: 0; }
    .cv-member { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 44px; }
    .cv-member .cv-on { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--panel-dim); margin-right: 6px; }
    .cv-member .cv-on.live { background: var(--gain, #2a6); }
    .cv-member .cv-car { display: block; margin-left: 14px; font-size: 12px; color: var(--panel-dim); }
    .cv-member.asked { opacity: 0.72; }
    .cv-member.asked.no { opacity: 0.5; }
    .cv-member .cv-state { font-size: 13px; color: var(--panel-dim); }
    /* Who's coming? (Nate 2026-11-16, "convoy up in two taps"): friends' faces, tap to pick, one key sends */
    .cv-faces { display: grid; grid-template-columns: repeat(auto-fill, minmax(68px, 1fr)); gap: 12px 6px; }
    .cv-face { display: flex; flex-direction: column; align-items: center; gap: 6px; min-height: 44px; padding: 4px 0; border: 0; background: none;
      color: var(--panel-ink); font: 500 12px var(--font-ui, sans-serif); }
    .cv-face > span:last-child { max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cv-face .avatar { box-shadow: 0 0 0 3px var(--panel); transition: box-shadow 120ms ease; }
    .cv-face[aria-pressed="true"] .avatar { box-shadow: 0 0 0 3px var(--panel), 0 0 0 5px var(--accent); }
    .cv-face[aria-pressed="true"] > span:last-child { color: var(--accent); font-weight: 700; }
    .cv-send { width: 100%; min-height: 52px; font-size: 17px; }
    .cv-alt { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px 20px; }
    /* the invite's card: over the map, wherever you were; one question, Join or Not now */
    .cv-invite .card-sheet { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding-top: 28px; }
    .cv-invite h2 { margin: 6px 0 0; font-size: 22px; }
    .cv-invite .cv-sub { margin: 0; color: var(--panel-dim); font-size: 15px; }
    .cv-invite .cv-keys { display: grid; gap: 4px; width: 100%; margin-top: 10px; }
    .cv-invite .cv-keys .ink-btn.solid { min-height: 54px; font-size: 18px; }
    .cv-invite .cv-fine { margin: 2px 0 0; font-size: 12px; color: var(--panel-dim); }
    .cv-invite .avatar.gone { opacity: 0.45; }
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
    const live = { headline: null, regroup: null, talk: null, gaps: [], left: [] };   // text nodes updated in place

    const client = new C.ConvoyClient({
      apiFetch, wsUrl,
      onChange: (s, what) => {
        snap = s; store.set('localStorage', RESUME_KEY, s.id || '');
        if (!s.id && voice && voice.state !== 'off') voice.stop();     // the convoy ended or we left: so did its channel
        paint(what);
      },
      onVoice: (m) => voiceEvent(m),
      onHazard: () => tick(),
      onRetract: (ev) => { if (spoken.has(ev.eventId)) toast(`${C.KINDS[ev.type] || 'Hazard'} call cancelled by the leader.`); spoken.delete(ev.eventId); paintMap(); },
      onError: (code) => toast(ERRORS[code] || 'The convoy refused that.'),
      // the leader kept it going: everyone hears it at once, with how long it now has (they can leave as before)
      onExtended: (m) => { const t = `Convoy kept going: ${C.leftText(m.expiresAtMs)}.`; toast(t); if (driving()) speak(t, false); },
      onDeclined: (h) => { if (!driving()) toast(`@${h} can't make it.`); },   // in a drive the list says it; nothing interrupts the road
    });
    // Voice (web/convoy_voice.js, docs/CONVOY_VOICE.md): an open channel, hands-free. One key on the convoy's line: Talk,
    // then Mute / Unmute. Once someone has talked in a convoy, the next convoy joins the channel by itself when it connects.
    const V = root.ApexConvoyVoice, VOICE_KEY = 'apex.convoyVoice';
    const voice = V ? new V.ConvoyVoice({ client, apiFetch, speaking: page.speaking || (() => false), native: page.nativeTalk || (() => {}), onChange: () => paintVoice() }) : null;
    let voiceKeyEl = null, lastVoice = 'off', lastVoiceErr = null;
    const voiceOffered = () => !!(voice && voice.supported && snap && snap.id && snap.voiceReady && snap.status !== 'replaced');
    function voiceEvent(m) {
      if (!voice) return;
      if (m.type === 'ready' && (voice.state === 'off' || voice.state === 'failed')) {
        if (voiceOffered() && store.get('localStorage', VOICE_KEY)) voice.start();
        return;
      }
      voice.onVoice(m);
    }
    function paintVoice() {
      if (!voice) return;
      if (voice.state === 'on') store.set('localStorage', VOICE_KEY, '1');
      if (voice.state === 'failed' && voice.error !== lastVoiceErr) toast(voice.errorText());
      lastVoiceErr = voice.state === 'failed' ? voice.error : null;
      if (voiceKeyEl) {
        const k = V.keyText(voice.state, voice.muted);
        voiceKeyEl.textContent = k.text; voiceKeyEl.setAttribute('aria-label', k.label);
        voiceKeyEl.classList.toggle('on', k.on); voiceKeyEl.classList.toggle('muted', voice.state === 'on' && voice.muted);
      }
      if (live.talk) live.talk.textContent = voice.state === 'on' ? V.talkingText(voice.talking, client.members) : '';
      if (voice.state !== lastVoice) { lastVoice = voice.state; lastKey = null; paint(); }   // the sheet's Leave voice comes and goes
    }
    function voiceKey() {
      voiceKeyEl = el('button', { type: 'button', className: 'ink-btn cv-key cv-talk' });
      voiceKeyEl.addEventListener('click', () => { voice.press(); });
      paintVoice();
      return voiceKeyEl;
    }
    // Another hour, the leader's (C.canKeep): from the card's key and from the heads-up before the end.
    const KEEP_REFUSED = { convoy_at_limit: 'A convoy runs six hours at most.', too_early: 'You can keep it going in its last half hour.' };
    async function keepGoing() {
      const r = await client.keepGoing();
      if (r.ok) { if (client.status !== 'live') toast(`Convoy kept going: ${C.leftText(r.body.expiresAtMs)}.`); return; }   // connected, the convoy says it itself
      toast((r.body && KEEP_REFUSED[r.body.error]) || (r.status === 404 ? 'That convoy has ended.' : 'Couldn\'t reach the convoy. Try again.'));
    }
    const endingSaid = new Set();

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
      // ten minutes before it ends everyone is told, once; the leader's has the key that keeps it going
      const ending = C.endingNote(snap.ctx, Date.now(), endingSaid);
      // (no `ms`: a timed action holds the page's toast, and would swallow the answer when the card's own key is used)
      if (ending) { toast(ending.text, ending.keep ? { label: 'Keep going', onClick: keepGoing } : undefined); if (driving()) speak(ending.text, false); }
      paintMap(); paintText();
      if (structKey() !== lastKey) paint();                             // a drive started or ended: the calls come or go; or the last half hour began
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
                             !!client.route, !!client.regroup, undo && undo.id, !!getRoute(), driving(), C.canKeep(s.ctx), voiceOffered(), voice && voice.state,
                             (s.invited || []).map((i) => [i.handle, i.declined])]);
    }
    // P-21: one line, a tap opens the convoy. Idle with an invite waiting, the line is the invite; in a drive it sits behind
    // the car, and the leader's calls open from it or from the Report key, never as a row over the map.
    function paintBar() {
      const s = snap, idle = !(s && s.id);
      const inv = idle && !driving() ? asked.list[0] || null : null, link = idle && !driving() && !inv ? store.get('sessionStorage', INVITE_KEY) : '';
      bar.classList.toggle('show', !idle || !!inv || !!link);
      live.headline = null; live.regroup = null; live.talk = null; voiceKeyEl = null;
      const line = (dot, name, text) => {
        const b = el('button', { type: 'button', className: 'cv-line' }, el('i', { className: dot }), el('b', { textContent: name }), text);
        b.addEventListener('click', () => (idle && inv ? openInvite(inv.id) : open()));
        return b;
      };
      if (idle) {
        if (!inv && !link) { bar.replaceChildren(); return; }
        const ln = line('ask', inv ? inv.name : 'Convoy link', el('span', { textContent: inv ? `${inv.from ? '@' + inv.from : 'A friend'} invited you` : 'Join it?' }));
        labelled(ln, inv ? `${inv.from ? '@' + inv.from : 'A friend'} invited you to the convoy ${inv.name}. Open it` : 'A convoy link. Open it');
        bar.replaceChildren(ln);
        return;
      }
      // one line: who and how many live (and the regroup point); the leader's calls are behind it, never under it
      live.headline = el('span');
      if (client.regroup) live.regroup = el('span', { className: 'cv-rg' });
      const name = s.ctx ? s.ctx.name : 'Convoy', calling = callsOn();
      const ln = line(s.status === 'live' ? '' : 'off', name, live.headline);
      // a calm drive (Nate, 2026-11-16): in a drive the line is a chip of faces; the names and the count stay for VoiceOver
      const others = (s.members || []).filter((m) => m.key !== (s.ctx && s.ctx.you) && m.online);
      const faces = el('span', { className: 'cv-faces' });
      for (const m of others.slice(0, 3)) faces.append(el('b', { textContent: String(m.handle || '?').replace(/^@/, '').slice(0, 1).toUpperCase() }));
      if (others.length > 3) faces.append(el('b', { className: 'more', textContent: `+${others.length - 3}` }));
      ln.insertBefore(faces, ln.children[1]);
      ln.classList.toggle('ok', s.status === 'live');
      if (live.regroup) ln.append(live.regroup);
      if (voiceOffered()) ln.append(live.talk = el('span', { className: 'cv-talking' }));
      const kids = [labelled(ln, `Convoy ${name}. ${calling ? 'Open it for your calls' : 'Open it'}`)];
      if (voiceOffered()) kids.push(voiceKey());
      if (s.status === 'replaced') kids.push(btn('Use it here', () => client.takeOver(), 'ink-btn cv-key'));
      else if (calling && undo) kids.push(btn(`Undo ${C.KINDS[undo.type]}`, undoCall, 'ink-btn cv-key cv-undo'));   // 3 s, then gone
      bar.replaceChildren(...kids);
    }
    // The leader's calls are for the road: only in a drive, and only when asked for (the Report key's sheet, the line).
    const callsOn = () => !!(snap && snap.id && snap.status !== 'replaced' && isLeader() && driving());
    function regroupKey(done) {
      return btn(client.regroup ? 'Clear regroup' : 'Regroup here', () => {
        done();
        if (client.regroup) { if (!client.clearRegroup()) toast('Not connected to the convoy.'); }
        else if (!getFix()) toast('No GPS fix yet.');
        else if (!client.callRegroup(getFix())) toast('Not connected to the convoy.');
      }, 'ink-btn');
    }
    // The calls as a sheet's block, in rows that wrap (never a row cut off at the screen's edge); a call closes the sheet.
    // the calls the public report has no mark for (this file loads on first use, so they stay off the map page's startup)
    const OWN_MARKS = {
      bump: '<path d="M3 17h4.5c1.8 0 2.6-5 4.5-5s2.7 5 4.5 5H21"/><path d="M3 20h18"/>',
      stopped: '<path d="M5 15l1.6-4.6A2 2 0 0 1 8.5 9h7a2 2 0 0 1 1.9 1.4L19 15v3.5H5z"/><circle cx="8" cy="15.5" r="1"/><circle cx="16" cy="15.5" r="1"/><path d="M12 3v3.5M8.5 4.5l1 1.8M15.5 4.5l-1 1.8"/>',
      regroup: '<path d="M6 21V4h11l-2.2 4 2.2 4H6"/>' };
    function callsBox(done) {
      const grid = el('div', { className: 'hz-grid cv-call-grid' });
      // each call its mark over its word, as the public kinds below it (cockpit.js ApexHazardIcons); words alone without it
      const mark = (b, k) => { const d = OWN_MARKS[k] || (window.ApexHazardIcons && window.ApexHazardIcons[k]); if (!d) return b;
        b.classList.add('hz-btn', 'hz-drawn'); b.insertAdjacentHTML('afterbegin', `<svg class="hz-ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`); return b; };
      for (const k of LEADER_CALLS) grid.append(labelled(mark(btn(C.KINDS[k], () => { done(); callOut(k); }, 'ink-btn hz-btn'), k), `Call ${C.KINDS[k]} to the convoy`));
      grid.append(mark(regroupKey(done), 'regroup'));
      return el('div', { className: 'cv-callbox' }, el('h3', { textContent: 'Call to the convoy' }),
        el('p', { className: 'note', textContent: 'Only your convoy hears these.' }), grid);
    }
    // The Report key's sheet (the page's): the convoy's calls on top while you lead a drive, the public report under them.
    function paintReport() {
      const sheetEl = page.reportSheet, card = sheetEl && sheetEl.querySelector('.card-sheet');
      if (!card) return;
      const was = card.querySelector('.cv-report'), key = callsOn() ? String(!!client.regroup) : '';
      if (was && was.dataset.key === key) return;                       // rebuilt only when its keys change: no tap lost
      if (!key) { if (was) was.remove(); return; }
      const box = callsBox(() => sheetEl.classList.remove('show'));
      box.classList.add('cv-report'); box.dataset.key = key;
      if (was) was.replaceWith(box); else card.prepend(box);
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
          // Nate 2026-11-12 (social never in the way of the road): while you drive a new invite isn't said or marked seen;
          // it toasts when the drive ends (below)
          const quiet = driving(), fresh = list.find((i) => !asked.seen.has(i.id));
          if (!quiet) for (const i of list) asked.seen.add(i.id);
          const changed = JSON.stringify(list.map((i) => i.id)) !== JSON.stringify(asked.list.map((i) => i.id));
          asked.list = list;
          if (fresh && !quiet && !(card && card.id === fresh.id)) toast(`${fresh.from ? '@' + fresh.from : 'A friend'} invited you to a convoy.`, { label: 'See it', ms: 10000, onClick: () => openInvite(fresh.id) });
          if (changed) { lastKey = null; paint(); }
        }
      } catch (_) { /* signed out or offline: try again next minute */ }
      finally { asked.at = Date.now(); asked.busy = false; }
    }
    setInterval(() => { if (!document.hidden) loadAsked(); }, 60e3);
    let wasDriving = false;                                           // a drive just ended: what came in during it, now
    setInterval(() => { const d = driving(); if (wasDriving && !d) loadAsked(true); wasDriving = d; }, 2000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAsked(); });
    setTimeout(() => loadAsked(true), 3000);

    // Who you can invite: accepted friends, then private crew-mates, by handle (the server re-checks each one). Kept a
    // minute, so the sheet opens on faces, not on "Loading".
    const known = { list: null, at: 0, busy: null };
    function loadPeople(force = false) {
      if (known.busy) return known.busy;
      if (!force && known.list && Date.now() - known.at < 60e3) return Promise.resolve(known.list);
      known.busy = (async () => {
        const by = new Map();
        try {
          const friends = await apiFetch('/api/friends', { method: 'GET' }).then((r) => (r.ok ? r.json() : null));
          if (!Array.isArray(friends)) return known.list;            // offline or signed out: what we had
          for (const f of friends) if (f.status === 'accepted' && f.handle) by.set(f.handle, { handle: f.handle, photo: f.photo_id || null });
          const crews = await apiFetch('/api/crews', { method: 'GET' }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
          for (const c of (crews || []).filter((c) => c.visibility !== 'public').slice(0, 10)) {
            const mem = await apiFetch(`/api/crews/${encodeURIComponent(c.id)}/members`, { method: 'GET' }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
            for (const m of mem || []) if (m.handle && !m.mine && !by.has(m.handle)) by.set(m.handle, { handle: m.handle, photo: m.photo_id || null });
          }
          known.list = [...by.values()].sort((a, b) => a.handle.localeCompare(b.handle)); known.at = Date.now();
          return known.list;
        } catch (_) { return known.list; }
        finally { known.busy = null; }
      })();
      return known.busy;
    }
    const face = (photo, handle, px) => (page.avatar ? page.avatar(photo, handle, px) : root.ApexPhotos ? root.ApexPhotos.avatar(photo, handle, px) : el('span', { className: 'avatar' }));
    const photoOf = (h) => ((known.list || []).find((p) => p.handle === h) || {}).photo || null;
    /** Faces to tap, then one key: `send(handles)` resolves true when it worked (the picker then clears). `skip`: handles
     *  already in or invited. Up to 15 at once, as the Worker takes. */
    function facesPicker(box, { label, send, skip = new Set(), empty }) {
      const paintIt = (list) => {
        const picks = (list || []).filter((p) => !skip.has(p.handle));
        if (!list) { box.replaceChildren(el('p', { className: 'note', textContent: 'No connection. Your friends show here when it\'s back.' })); return false; }
        if (!picks.length) { box.replaceChildren(...(empty ? empty() : [])); return false; }
        const chosen = new Set();
        const go = btn(label(0), once(async () => {
          if (!chosen.size) { toast('Tap the friends who are coming.'); return; }
          go.disabled = true;
          try { if (await send([...chosen])) { chosen.clear(); } } finally { go.disabled = false; go.textContent = label(chosen.size); }
        }), 'ink-btn solid cv-send');
        const grid = el('div', { className: 'cv-faces' }, ...picks.map((p) => {
          const b = el('button', { type: 'button', className: 'cv-face' }, face(p.photo, p.handle, 58), el('span', { textContent: p.handle }));
          b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', '@' + p.handle);
          b.onclick = () => {
            if (chosen.has(p.handle)) chosen.delete(p.handle); else if (chosen.size < 15) chosen.add(p.handle);
            b.setAttribute('aria-pressed', String(chosen.has(p.handle))); go.textContent = label(chosen.size);
          };
          return b;
        }));
        box.replaceChildren(grid, go);
        return true;
      };
      if (known.list) paintIt(known.list); else box.replaceChildren(el('p', { className: 'note', textContent: 'Finding your friends…' }));
      loadPeople().then((list) => { if (box.isConnected && !box.querySelector('[aria-pressed="true"]')) paintIt(list); });
    }
    const inviteWord = (n) => (n ? `Invite ${n}` : 'Invite');
    /** Leader: invite these handles into the live convoy. A short toast; true when the request went through. */
    async function sendInvites(handles) {
      const r = await client.post(`/api/convoy/${encodeURIComponent(snap.id)}/invite-people`, { handles });
      if (!r.ok) { toast(r.status === 429 ? 'That\'s a lot of invites. Wait for some to join.' : r.status === 0 || r.status >= 500 ? 'No connection. Try again in a moment.' : 'Couldn\'t send the invites. Try again.'); return false; }
      const n = r.body.invited || 0;
      toast(n ? (handles.length === 1 ? `Invited @${handles[0]}.` : `Invited ${n}.`) : 'They\'re already invited.');
      return true;
    }
    // The leader's Add friends: the same faces, without anyone already in or waiting on an invite.
    function invitePeople(box) {
      if (box.childElementCount) { box.replaceChildren(); return; }   // a second tap folds it away
      const skip = new Set([...(snap && snap.members || []).map((m) => m.handle), ...((snap && snap.invited) || []).filter((i) => !i.declined).map((i) => i.handle)]);
      facesPicker(box, { label: inviteWord, skip, send: async (hs) => { const ok = await sendInvites(hs); if (ok) box.replaceChildren(); return ok; },
        empty: () => [el('p', { className: 'note', textContent: 'Everyone you know is in or invited. Share the link for anyone else.' })] });
    }
    /** Start a convoy (named for nobody: "Convoy") and invite these friends into it: the two taps. */
    async function startWith(handles) {
      const r = await client.start('');
      if (!r.ok) {
        toast(r.status === 401 || r.status === 403 ? 'Sign in on People to drive in a convoy.' : r.status === 429 ? 'You already lead two convoys. End one first.' : 'Couldn\'t start a convoy. Check signal and try again.');
        return false;
      }
      if (handles.length) await sendInvites(handles);
      return true;
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
      // the code to read out (IDEAS S-22), for a friend whose camera can't see the screen: six characters, no 0/O or 1/I
      const said = el('p', { className: 'cv-code', textContent: '' });
      said.hidden = true;
      box.replaceChildren(cv, el('p', { className: 'note', textContent: 'Point a phone camera at it to join. Works for 30 minutes.' }), said,
        el('div', { className: 'row' }, btn('Hide', () => box.replaceChildren(), 'linkbtn'),   // a new link belongs with the code it replaces, not on the convoy's own row
          btn('New link', async () => { if (await ApexConfirm.ask('Make a new link? The old one stops working for anyone who hasn\'t joined yet.', 'New link')) { await shareInvite(true); showQr(box); } }, 'linkbtn')));
      const code = await client.leaderCode();
      if (code && said.isConnected) {
        said.textContent = `Or join code ${code.slice(0, 3)} ${code.slice(3)}`; said.hidden = false;
        said.setAttribute('aria-label', `Or join code ${[...code].join(' ')}, for 15 minutes`);
      }
    }
    // Join with a code read out by the leader (IDEAS S-22): Convoys → the code → Join. Joining shares your position.
    // Return on the phone keyboard does what the key beside the field does, once (walkthrough 2026-11-12: Return did
    // nothing, and a second tap while it worked spent another of the code's few tries or started a second convoy)
    function onReturn(input, go) { input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } }); }
    const once = (fn) => { let busy = false; return async (...a) => { if (busy) return; busy = true; try { return await fn(...a); } finally { busy = false; } }; };
    function codeRow() {
      const input = labelled(el('input', { className: 'field', placeholder: 'Join code', maxLength: 9, autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, enterKeyHint: 'go' }), 'Convoy join code');
      const join = once(async () => {
          const v = input.value.trim();
          if (!v) { toast('Type the code the leader gave you.'); input.focus(); return; }
          const r = await client.joinCode(v);
          if (r.ok) { toast('You\'re in the convoy. Your position is shared with it until you leave.'); return; }
          toast(r.status === 429 ? 'Too many tries. Wait ten minutes, or ask for the link.' : r.status === 409 ? 'That convoy is full.'
            : r.status === 403 ? 'That code is no longer yours to use. Ask the leader for the link.'
            : r.status === 0 || r.status >= 500 ? 'No connection. Try again in a moment.' : 'That code didn\'t work. Check it with the leader.');
        });
      onReturn(input, join);
      return [el('p', { className: 'note', textContent: 'Got a join code from the leader? Joining shares your position with the convoy.' }),
        el('div', { className: 'row' }, input, btn('Join with code', join, 'ink-btn'))];
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
          // an invite waiting: one row, its card a tap away (the card checks it and says why when it can't be used)
          const row = el('button', { type: 'button', className: 'nav-row cv-asked' }, face(photoOf(inv.from), inv.from, 36),
            el('span', { textContent: `${inv.from ? '@' + inv.from : 'A friend'} invited you` }), el('small', { textContent: C.leftText(inv.expiresAtMs).replace(' left', '') }));
          row.addEventListener('click', () => { close(); openInvite(inv.id); });
          kids.push(row);
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
        } else {
          // Who's coming? (Nate 2026-11-16): faces first; Invite starts the convoy and sends each one a notification. No name
          // to type, no separate Start. Links, the QR code and the join code stay below for anyone who isn't a friend yet.
          const faces = h.faces || (h.faces = el('div', { className: 'stack-8' }));
          kids.push(el('h3', { textContent: asked.list.length ? 'Or start your own' : 'Who\'s coming?' }), faces);
          if (!faces.childElementCount) {
            facesPicker(faces, { label: inviteWord, send: startWith,
              empty: () => [el('p', { className: 'note', textContent: 'Drive together, live, up to sixteen cars.' }), btn('Start a convoy', once(() => now('')), 'ink-btn solid cv-send')] });
          }
          const alt = el('div', { className: 'cv-alt' },
            btn('Share link', once(async () => { if (await startWith([])) shareInvite(false); }), 'linkbtn'),
            btn('QR code', once(() => now('')), 'linkbtn'),
            btn('Join code', () => { alt.replaceWith(...codeRow()); }, 'linkbtn'));
          if (h.code) { h.code = false; kids.push(...codeRow()); } else kids.push(alt);   // Ways to go → Join with a code: the field at once
        }
        box.replaceChildren(...kids);
        return;
      }
      const c = s.ctx;
      h.faces = null;                                                  // a convoy now: Who's coming? starts fresh after it
      if (h.kind === 'sheet' && callsOn()) kids.push(callsBox(close));   // a tap on the line in a drive: the calls first
      // P-28: how long it has left, kept fresh every second, not the clock time it ends
      const left = el('span', { textContent: C.leftText(c.expiresAtMs) });
      live.left.push(left);
      kids.push(el('p', { className: 'note' }, document.createTextNode(`${h.kind === 'sheet' && c.name && c.name !== 'Convoy' ? `${c.name} · you're` : 'You\'re'} ${c.role === 'leader' ? 'leading' : 'following'} · `), left));
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
      // the leader's: who they invited in the app and haven't joined; Not now shows as "can't make it"
      for (const i of (c.role === 'leader' && s.invited) || []) {
        list.append(el('div', { className: 'cv-member asked' + (i.declined ? ' no' : '') },
          el('span', {}, el('span', { className: 'cv-on' }), document.createTextNode('@' + i.handle)), el('span', { className: 'cv-state', textContent: i.declined ? 'can\'t make it' : 'invited' })));
      }
      kids.push(list);
      // the picker (invite friends, the QR code) is the host's own: a status change redraws around it, never wipes it
      const actions = el('div', { className: 'row', style: 'flex-wrap:wrap' }), picker = h.picker || (h.picker = el('div', { className: 'stack-8' }));
      if (c.role === 'leader') {
        actions.append(btn('Add friends', () => invitePeople(picker), 'ink-btn solid'), btn('Show QR', () => showQr(picker)), btn('Share link', () => shareInvite(false)));
        const r = getRoute();
        const shareMsg = { sent: (n) => `${n} shared with the convoy.`, offline: () => 'Not connected to the convoy.', too_long: () => 'That route is too long to share.' };
        if (r) actions.append(btn(client.route ? 'Update shared route' : 'Share my route', () => { const out = client.shareRoute(r.name, r.pts); toast(shareMsg[out](r.name)); }));
        else if (client.route) actions.append(btn('Stop sharing route', () => { if (!client.clearRoute()) toast('Not connected to the convoy.'); }));
      }
      // from the map's sheet, the drive itself is one key away (a convoy started at the petrol station, then go)
      if (h.kind === 'sheet' && !driving() && page.drive) actions.append(btn('Start the drive', () => { close(); page.drive(); }, 'ink-btn'));
      if (C.canKeep(c)) actions.append(btn('Keep going 1 h', keepGoing, 'ink-btn'));
      if (voice && (voice.state === 'on' || voice.state === 'starting')) actions.append(btn('Leave voice', () => { store.set('localStorage', VOICE_KEY, ''); voice.stop(); }, 'ink-btn'));   // its last half hour: the leader's to give it another hour
      actions.append(btn(c.role === 'leader' ? 'End convoy' : 'Leave', async () => {
        if (!(await ApexConfirm.ask(c.role === 'leader' ? 'End the convoy for everyone?' : 'Leave the convoy?', c.role === 'leader' ? 'End convoy' : 'Leave'))) return;
        await client.leave(); toast(c.role === 'leader' ? 'Convoy ended.' : 'You left the convoy.');
      }, 'linkbtn'));
      kids.push(actions);
      if (c.role === 'leader') kids.push(picker);
      if (s.status === 'replaced') kids.push(el('div', { className: 'row' }, el('span', { className: 'note', textContent: 'This convoy is open on another screen.' }), btn('Use it here', () => client.takeOver())));
      else if (s.status !== 'live') kids.push(el('p', { className: 'note', textContent: s.unreachable ? 'Can\'t reach the convoy. Still trying.' : s.status === 'reconnecting' ? 'No connection to the convoy. Retrying…' : 'Connecting…' }));
      box.replaceChildren(...kids);
      if (h.kind === 'sheet' && voiceOffered() && voice.state !== 'on') box.append(el('p', { className: 'note', textContent: 'Tap Talk to hear and talk to the convoy, hands-free.' }));
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
      if (what === 'structure' && key !== lastKey) { lastKey = key; renderAll(); paintBar(); paintReport(); tellWatchers(); }
      paintText(); paintMap();
    }

    // The convoy sheet over the map: from the line, an invite's toast, a convoy link, and Convoy now.
    let sheet = null;
    function open(opts) {
      if (sheet && sheet.el.isConnected) return;
      const host = { box: el('div', { className: 'stack-8' }), kind: 'sheet', code: !!(opts && opts.code) };
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
    function takeInvite(fromLink, opts = {}) {
      if (!fromLink.includes('.')) { openInvite(fromLink, opts); return; }   // a convoy id alone: an in-app invite (a push's tap)
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
    // ---- the invite's card (Nate 2026-11-16): a push's tap, the convoy line, a row in the sheet. One question, Join or Not
    // now, and every way it can't be used said in a few words: ran out, full, not yours, already in, another convoy, no signal.
    let card = null;
    function openInvite(id, { join = false } = {}) {
      if (!/^[A-Za-z0-9_-]{22}$/.test(id || '')) return;
      if (card) closeInvite();
      if (sheet) close();
      if (page.clearToast) page.clearToast();                           // the invite's own "See it" toast: answered here now
      const inv = asked.list.find((x) => x.id === id) || null;
      const body = el('div', { className: 'card-sheet' });
      const back = el('div', { className: 'overlay dim show convoy-sheet cv-invite' }, body);
      back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true'); back.setAttribute('aria-label', 'Convoy invite');
      back.addEventListener('click', (e) => { if (e.target === back) closeInvite(); });
      const key = (e) => { if (e.key === 'Escape' && !(root.ApexConfirm && root.ApexConfirm.open)) closeInvite(); };
      document.addEventListener('keydown', key);
      card = { id, el: back, key, body, lead: inv ? inv.from : null, pv: null, join };
      document.body.append(back);
      paintInvite('loading');
      checkInvite();
    }
    function closeInvite() {
      if (!card) return;
      card.el.remove(); document.removeEventListener('keydown', card.key); card = null;
    }
    async function checkInvite() {
      const c = card;
      let r = null;
      try { r = await apiFetch(`/api/convoy/invites/${encodeURIComponent(c.id)}`, { method: 'GET' }); } catch (_) { r = null; }
      if (card !== c) return;
      const st = r ? r.status : 0;
      if (r && r.ok) {
        c.pv = await r.json().catch(() => null);
        if (card !== c) return;
        if (!c.pv) { paintInvite('offline'); return; }
        if (c.pv.leader && c.pv.leader.handle) c.lead = c.pv.leader.handle;
        if (c.pv.member) { paintInvite('member'); return; }
        if (snap && snap.id && snap.id !== c.id) { paintInvite('switch'); return; }     // never leaves a convoy without asking
        if (c.join) { c.join = false; joinInvite(); return; }                           // the notification's Join convoy
        paintInvite('ready');
        return;
      }
      if (st === 400 || st === 404) dropAsked(c.id);
      paintInvite(st === 401 ? 'signedout' : st === 409 ? 'full' : st === 403 ? 'blocked' : st === 400 || st === 404 ? 'gone' : 'offline');
    }
    const dropAsked = (id) => { if (asked.list.some((x) => x.id === id)) { asked.list = asked.list.filter((x) => x.id !== id); lastKey = null; paint(); } };
    async function joinInvite() {
      const c = card;
      if (!c) return;
      paintInvite('joining');
      if (snap && snap.id && snap.id !== c.id) await client.leave();                    // Switch convoys: they said yes to it
      const r = await client.accept(c.id);
      if (card !== c) return;
      dropAsked(c.id);
      if (r.ok) {
        closeInvite();
        toast(`You're in. ${c.lead ? '@' + c.lead + ' sees' : 'The convoy sees'} you on the map.`);
        return;
      }
      paintInvite(r.status === 409 ? 'full' : r.status === 403 ? 'blocked' : r.status === 400 || r.status === 404 ? 'gone' : r.status === 401 ? 'signedout'
        : r.status === 429 ? 'many' : 'offline');
    }
    function paintInvite(state) {
      const c = card;
      if (!c) return;
      const pv = c.pv, lead = c.lead ? '@' + c.lead : null;
      const title = pv && pv.name && pv.name !== 'Convoy' ? pv.name : lead ? `${lead}'s convoy` : 'Convoy invite';
      const cars = pv ? `${pv.members} ${pv.members === 1 ? 'car' : 'cars'} in · ${C.leftText(pv.expiresAtMs)}` : '';
      const until = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const asked1 = asked.list.find((x) => x.id === c.id);
      const yes = (label, fn) => btn(label, once(fn), 'ink-btn solid');
      const no = (label = 'Not now') => btn(label, () => { notNow(c.id); }, 'linkbtn');
      const shut = (label = 'Close') => btn(label, closeInvite, 'linkbtn');
      const msg = () => (c.lead && page.message ? [btn(`Message ${lead}`, () => { closeInvite(); page.message(c.lead); }, 'ink-btn')] : []);
      const S = {
        loading: [title, 'Checking the invite…', []],
        ready: [title, cars, [yes('Join', joinInvite), no()], 'Joining shares your position with the convoy until you leave.'],
        joining: [title, 'Joining…', []],
        switch: [title, `You're in ${snap && snap.ctx && snap.ctx.name && snap.ctx.name !== 'Convoy' ? snap.ctx.name : 'a convoy'}. ${snap && snap.ctx && snap.ctx.role === 'leader' ? 'Joining this one ends yours for everyone.' : 'Joining this one leaves it.'}`,
          [yes('Switch convoys', joinInvite), no()]],
        member: ['You\'re in', `Already in ${title === 'Convoy invite' ? 'this convoy' : title}.`, [yes('Open convoy', async () => { closeInvite(); if (!(snap && snap.id === c.id)) await client.resume(c.id); open(); }), shut()]],
        gone: ['This invite ran out', `${lead ? lead + '\'s' : 'The'} convoy ended or the invite expired.`, [...msg(), shut()]],
        full: ['That convoy is full', `${pv ? pv.max : 16} cars already.${lead ? ` Ask ${lead} to make room.` : ''}`, [...msg(), shut()]],
        blocked: ['You can\'t join this convoy', '', [shut()]],
        many: ['You\'re in too many convoys', 'Leave one, then try again.', [shut()]],
        signedout: ['Sign in to join', 'Convoys are for signed-in drivers.', [...(page.showView ? [yes('Sign in', () => { closeInvite(); page.showView('friends'); })] : []), shut()]],
        offline: [title, `No connection.${asked1 ? ` The invite is good until ${until(asked1.expiresAtMs)}.` : ''}`, [yes('Try again', () => { paintInvite('loading'); return checkInvite(); }), no()]],
      }[state];
      const [h, sub, keys, fine] = S;
      const pic = face(photoOf(c.lead), c.lead || '?', 76);
      if (state === 'gone' || state === 'blocked') pic.classList.add('gone');
      c.body.replaceChildren(pic, el('h2', { textContent: h }), ...(sub ? [el('p', { className: 'cv-sub', textContent: sub })] : []),
        el('div', { className: 'cv-keys' }, ...keys), ...(fine ? [el('p', { className: 'cv-fine', textContent: fine })] : []));
      c.body.querySelector('.cv-keys .ink-btn.solid, .cv-keys button')?.focus?.({ preventScroll: true });
    }
    /** Not now: the invite goes, and the leader sees you can't make it. */
    function notNow(id) {
      closeInvite();
      asked.list = asked.list.filter((x) => x.id !== id); lastKey = null; paint();
      apiFetch(`/api/convoy/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    }
    /** One tap from a friend (their profile's Convoy key): your convoy, or a new one, and they're invited. No dialog: the
     *  invite is the whole action, and its toast opens the convoy. */
    async function inviteFriend(handle) {
      const h = String(handle || '').replace(/^@/, '');
      if (!h) return { ok: false };
      if (snap && snap.id) {
        if (!isLeader()) { toast(`Only the leader can invite. Ask them to add @${h}.`); return { ok: false, status: 'member' }; }
        const ok = await sendInvites([h]);
        return { ok };
      }
      const r = await client.start('');
      if (!r.ok) { toast(r.status === 401 || r.status === 403 ? 'Sign in on People to drive in a convoy.' : r.status === 429 ? 'You already lead two convoys. End one first.' : 'Couldn\'t start a convoy. Check signal and try again.'); return { ok: false, status: r.status }; }
      const inv = await client.post(`/api/convoy/${encodeURIComponent(client.id)}/invite-people`, { handles: [h] });
      const ok = inv.ok && inv.body && inv.body.invited > 0;
      toast(ok ? `Invited @${h} to your convoy.` : `Convoy started, but @${h} couldn't be invited. Share its link.`, { label: 'Open', ms: 6000, onClick: open });
      return { ok, invited: ok ? 1 : 0 };
    }

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
      accept, dismiss, open, close, now, openInvite, inviteFriend,
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
