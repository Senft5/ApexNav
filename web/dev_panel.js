// Dev mode's panel (the owner, 2026-11-09: "a dev mode in the app that shows all routing parameters and other debug info for
// only me and my codev to mess with"). Loaded lazily (lazy.js 'dev') and only on a developer's phone: cockpit.js devPanel()
// asks for it only while /api/me says this account is a developer (backend/src/developers.ts: the owner by OWNER_EMAIL, the
// co-developer by fingerprint, DEV_FINGERPRINTS), the gate the Satellite layer has. A tool, not a designed screen.
//
//   the plan    every candidate of the last plan: level, minutes, km, the router's goodness G and role, the engine's value
//               in its parts, why it was picked or dropped, highway km, our router or Valhalla; the timeline, the
//               plan's marks, the tile and index versions
//   tunables    graph_router.js K, route_engine.js W, fun_route.js LEVELS and HWY: edit, Re-plan applies them to the
//               trip on screen (the worker gets them as req.tune, the engine as setTune), Reset puts the code's values
//               back. Kept on this phone only (localStorage apex.dev, via the host), read only while dev mode is allowed
//   switches    Force own router, Force Valhalla, Offline simulation, Candidate lines on the map
//   Copy debug JSON   the plan's dump for a message to Claude
// The host (cockpit.js devHost) owns storage, the gate and the re-plan; this file draws and keeps no state of its own
// beyond what is on screen.
(function (root) {
  'use strict';
  // the knobs asked for first (the owner's list), then every other number in each table under "All"
  const KEY_KNOBS = {
    router: ['A_FIRST.quick', 'A_FIRST.fun', 'A_FIRST.max', 'A_MAX.quick', 'A_MAX.fun', 'A_MAX.max', 'BISECT', 'BUY.fun', 'BUY.max', 'BUY_MIN',
      'SPREAD.fun.0', 'SPREAD.max.0', 'ROAD.poor', 'ROAD.good', 'ROAD.w', 'ROAD.goodLo', 'ROAD.goodHi', 'W_NOTPOOR', 'W_QUALITY', 'W_FUN', 'W_SCENERY',
      'UNKNOWN_G', 'HWY_ABSURD', 'HWY_LINK_X', 'HWY_FREE_SLACK_S', 'ALT_MIN_DIFF', 'ALTS', 'LOWER.0', 'LOWER.1'],
    engine: ['QUALITY', 'POOR_PER_KM', 'POOR_CAP', 'POOR_Q_LO', 'POOR_Q_HI', 'GOOD_PER_KM', 'GOOD_CAP', 'GOOD_Q_LO', 'GOOD_Q_HI',
      'BUSINESS_PER_KM', 'BUSINESS_CAP', 'SCENERY', 'GATE_LO', 'GATE_HI', 'PENALTY_CAP', 'BONUS_CAP', 'DRIVER'],
    levels: ['quick.budget', 'quick.slackS', 'quick.perMin', 'fun.budget', 'fun.slackS', 'fun.perMin', 'max.budget', 'max.slackS', 'max.perMin'],
    hwy: ['ABSURD', 'FREE_KM', 'SLACK_S'],
  };
  const TABLES = [['router', 'Router (graph_router.js K)'], ['engine', 'Engine (route_engine.js W)'], ['levels', 'Levels (fun_route.js LEVELS)'], ['hwy', 'Highway rule (fun_route.js HWY)']];
  const SWITCHES = [['forceOwn', 'Force own router', 'our tiles only: Valhalla is never asked for routes (a trip off our tiles fails to plan); its turn instructions still are'],
    ['forceValhalla', 'Force Valhalla', 'our router off: today\'s Valhalla path'],
    ['offline', 'Offline simulation', 'this page\'s requests to any other host fail and the page reads as offline; the map\'s and the routing worker\'s own tile reads are untouched'],
    ['lines', 'Candidate lines', 'every candidate of the last plan on the map, a colour each (the panel\'s swatches)']];
  const COLOURS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324', '#469990', '#808000'];
  const LINES = 'apex-dev-cands';
  const doc = () => root.document;
  let host = null, panel = null, fetchWas = null;

  const make = (tag, props = {}, ...kids) => { const n = doc().createElement(tag); Object.assign(n, props); for (const k of kids) if (k != null) n.append(k); return n; };
  const num = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d)) : '--');
  const allowed = () => !!(host && host.allowed && host.allowed());

  // ---- the plan, summarised --------------------------------------------------------------------------------------------
  function sourceOf(c) {
    if (c.kind === 'own') return 'own router';
    if (c.kind === 'router') return c.highway ? 'Valhalla (highway costing)' : 'Valhalla';
    return `Valhalla (${c.kind})`;
  }
  function kmOf(c) {
    const d = c.t && c.t.dist;
    if (d && d.length) return d[d.length - 1] / 1000;
    return c.own && Number.isFinite(c.own.distM) ? c.own.distM / 1000 : null;
  }
  const round = (o, d = 3) => (o == null ? null : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(d) : v])));
  /** Why a candidate was the pick, came after it, or was dropped before the ranking's end. */
  function verdict(raw, c, v, k, best, limitS) {
    const F = root.ApexFunRoute;
    if (raw.picked && raw.picked.t === c.t) return k <= 0 ? 'picked: the highest value' : `picked: on screen, #${k + 1} after the fresh context (inside the swap margin)`;
    if (k === 0) return raw.refined ? 'ranked first after the fresh context, not swapped in (inside the swap margin, or driving)' : 'ranked first (not on screen: driving, or a pick since)';
    if (k > 0 && best && v) {
      const gaps = Object.keys(v.parts || {}).map((p) => [p, (v.parts[p] || 0) - ((best.parts && best.parts[p]) || 0)]).filter(([, d]) => Math.abs(d) >= 0.5).sort((a, b) => a[1] - b[1]);
      const lost = gaps.filter(([, d]) => d < 0).slice(0, 3).map(([p, d]) => `${p} ${d.toFixed(1)}`), won = gaps.filter(([, d]) => d > 0).slice(-2).map(([p, d]) => `${p} +${d.toFixed(1)}`);
      return `ranked #${k + 1}: ${(best.value - v.value).toFixed(1)} below #1${lost.length ? ` (${lost.join(', ')}` : ''}${won.length ? `${lost.length ? '; ' : ' ('}against ${won.join(', ')}` : ''}${lost.length || won.length ? ')' : ''}`;
    }
    if (v && v.infeasible) return `dropped: ${((c.ev && c.ev.hard) || []).map((h) => h.label).join(', ') || 'a hard constraint'}`;
    const L = F && F.LEVELS[raw.level];
    const hk = F ? F.highwayKm(c) : null;
    if (L && L.noHighway && Number.isFinite(hk) && hk > F.HWY.FREE_KM) return `dropped: ${hk.toFixed(1)} km of highway (${L.label} keeps off them)`;
    if (Number.isFinite(limitS) && c.timeS > limitS) return `dropped: over the level's budget (${(c.timeS / 60).toFixed(1)} > ${(limitS / 60).toFixed(1)} min)`;
    return 'dropped';
  }
  function summarize(raw) {
    if (!raw || !Array.isArray(raw.pool)) return null;
    const F = root.ApexFunRoute;
    const ranked = Array.isArray(raw.ranked) ? raw.ranked : [], valued = ranked.valued || ranked, limitS = ranked.limitS, best = ranked[0] || null;
    const cands = raw.pool.map((c, i) => {
      const v = valued.find((x) => x.t === c.t) || null, k = ranked.findIndex((x) => x.t === c.t), w = (c.own && c.own.why) || null;
      return {
        n: i + 1, colour: COLOURS[i % COLOURS.length], level: raw.level, source: sourceOf(c), kind: c.kind, min: Number.isFinite(c.timeS) ? +(c.timeS / 60).toFixed(2) : null, km: kmOf(c) != null ? +kmOf(c).toFixed(2) : null,
        router: w ? { role: c.ownRole || w.role, G: w.goodness != null ? +w.goodness.toFixed(4) : null, a: w.a, poorKm: +((w.poorKm || 0).toFixed(2)), goodKm: +((w.goodKm || 0).toFixed(2)),
          quality: w.quality != null ? +w.quality.toFixed(3) : null, fun: w.fun != null ? +w.fun.toFixed(3) : null, conf: w.conf != null ? +w.conf.toFixed(3) : null, signals: w.signals, junctions: w.junctions } : null,
        hwyKm: F && Number.isFinite(F.highwayKm(c)) ? +F.highwayKm(c).toFixed(2) : null,
        value: v && Number.isFinite(v.value) ? +v.value.toFixed(2) : null, parts: v ? round(v.parts, 2) : null,
        picked: !!(raw.picked && raw.picked.t === c.t), rank: k >= 0 ? k + 1 : null, why: verdict(raw, c, v, k, best, limitS),
        ev: c.ev ? round({ km: c.ev.km, knownKm: c.ev.knownKm, quality: c.ev.quality, poorKm: c.ev.poorKm, goodKm: c.ev.goodKm, businessKm: c.ev.businessKm, meanGate: c.ev.meanGate, confidence: c.ev.confidence }) : null,
        penalties: c.ev && c.ev.penalties ? c.ev.penalties.map((p) => ({ kind: p.kind, label: p.label, points: p.points })) : [],
      };
    });
    return { at: raw.at, level: raw.level, from: raw.from, to: raw.to, limitS: Number.isFinite(limitS) ? Math.round(limitS) : null, own: raw.own, tune: raw.tune || null, refined: raw.refined || null,
      switches: raw.switches || {}, cands, timeline: (raw.timeline || []).slice(), planMarks: (raw.planMarks || []).slice() };
  }

  // ---- switches that act outside the panel ------------------------------------------------------------------------------
  function sameHost(u) {
    try { const x = new URL(u, root.location.href), l = root.location; return x.protocol === l.protocol && x.host === l.host; } catch (_) { return true; }
  }
  function setOffline(on) {
    const nav = root.navigator;
    if (on && !fetchWas) {
      fetchWas = root.fetch;
      root.fetch = function devOffline(input, init) {
        const u = typeof input === 'string' ? input : input && input.url;
        if (u && !sameHost(u)) return Promise.reject(new TypeError('Failed to fetch (Dev offline simulation)'));
        return fetchWas.call(root, input, init);
      };
      try { Object.defineProperty(nav, 'onLine', { configurable: true, get: () => false }); } catch (_) { /* read-only here */ }
      try { root.dispatchEvent(new Event('offline')); } catch (_) {}
    } else if (!on && fetchWas) {
      root.fetch = fetchWas; fetchWas = null;
      try { delete nav.onLine; } catch (_) {}
      try { root.dispatchEvent(new Event('online')); } catch (_) {}
    }
  }
  function drawLines() {
    const map = host && host.map;
    if (!map || !map.getStyle) return;
    const on = allowed() && !!(host.settings() || {}).lines, s = on ? summarize(host.plan()) : null, raw = on ? host.plan() : null;
    const features = s ? raw.pool.map((c, i) => ({ type: 'Feature', properties: { c: COLOURS[i % COLOURS.length], w: s.cands[i].picked ? 6 : 3, n: i + 1 },
      geometry: { type: 'LineString', coordinates: (c.route && c.route.coords) || [] } })).filter((f) => f.geometry.coordinates.length >= 2) : [];
    const go = () => {
      try {
        if (!on) { if (map.getLayer(LINES)) map.removeLayer(LINES); if (map.getSource(LINES)) map.removeSource(LINES); return; }
        const fc = { type: 'FeatureCollection', features };
        if (map.getSource(LINES)) map.getSource(LINES).setData(fc);
        else map.addSource(LINES, { type: 'geojson', data: fc });
        if (!map.getLayer(LINES)) map.addLayer({ id: LINES, type: 'line', source: LINES, layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-opacity': 0.85, 'line-offset': ['*', 1.5, ['-', ['get', 'n'], 1]] } }, map.getLayer('apex-route-casing') ? 'apex-route-casing' : undefined);
      } catch (e) { console.error('dev lines', e); }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded() && !map.getStyle()) map.once('load', go); else go();
  }
  function applySwitches() {
    const s = (allowed() && host.settings()) || {};
    setOffline(!!s.offline);
    drawLines();
  }

  // ---- the panel ---------------------------------------------------------------------------------------------------------
  const CSS = `#devPanel{position:fixed;left:0;right:0;top:0;max-height:62vh;overflow:auto;z-index:9000;background:#111;color:#eee;font:12px/1.35 ui-monospace,Menlo,monospace;
padding:calc(env(safe-area-inset-top,0px) + 6px) 10px 10px;border-bottom:2px solid #f58231;-webkit-overflow-scrolling:touch}
#devPanel[hidden]{display:none}#devPanel h4{margin:10px 0 4px;font-size:12px;color:#f58231}#devPanel button{font:inherit;margin:2px 4px 2px 0;padding:4px 8px;background:#333;color:#eee;border:1px solid #666;border-radius:4px}
#devPanel .dv-c{border-top:1px solid #333;padding:4px 0}#devPanel .dv-c.pick{background:#1e2a1e}#devPanel .dv-sw{display:inline-block;width:10px;height:10px;margin-right:4px;vertical-align:middle}
#devPanel .dv-k{display:flex;justify-content:space-between;gap:6px;padding:1px 0}#devPanel .dv-k input{width:84px;font:inherit;background:#222;color:#eee;border:1px solid #555}
#devPanel .dv-k.set input{border-color:#f58231;color:#f58231}#devPanel .dv-mut{color:#999}#devPanel textarea{width:100%;height:120px;font:inherit;background:#222;color:#eee}
#devPanel label{display:block;padding:2px 0}#devPanel .dv-head{display:flex;justify-content:space-between;align-items:center;position:sticky;top:-6px;background:#111}`;
  function knobRow(table, path, def, cur, pending) {
    const inp = make('input', { type: 'number', step: 'any', value: String(cur != null ? cur : def), inputMode: 'decimal' });
    inp.dataset.table = table; inp.dataset.path = path;
    const row = make('div', { className: 'dv-k' + (cur != null ? ' set' : '') }, make('span', { textContent: `${path}  `, title: `default ${def}` }, make('span', { className: 'dv-mut', textContent: `(${def})` })), inp);
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      if (inp.value === '' || !Number.isFinite(v) || v === def) { if (pending[table]) delete pending[table][path]; row.classList.remove('set'); }
      else { (pending[table] = pending[table] || {})[path] = v; row.classList.add('set'); }
      count();
    });
    return row;
  }
  let pending = {}, count = () => {};
  function render() {
    if (!panel || !allowed()) return;
    const s = host.settings() || {}, defs = host.defaults() || {}, sum = summarize(host.plan());
    panel.textContent = '';
    const nOver = () => Object.values(pending).reduce((a, m) => a + Object.keys(m || {}).length, 0);
    const over = make('span', { className: 'dv-mut' });
    count = () => { over.textContent = `${nOver()} override${nOver() === 1 ? '' : 's'}`; };
    count();
    const replan = make('button', { type: 'button', id: 'devReplan', textContent: 'Re-plan' });
    replan.addEventListener('click', () => { save({ tune: clean(pending) }); if (host.planned()) { status('Re-planning…'); Promise.resolve(host.replan()).then(() => status('Re-planned')).catch(() => status('Re-plan failed')); } else status('Saved; plan a trip to use them'); });
    const reset = make('button', { type: 'button', id: 'devReset', textContent: 'Reset' });
    reset.addEventListener('click', () => { pending = {}; save({ tune: {} }); render(); if (host.planned()) { status('Defaults back, re-planning…'); Promise.resolve(host.replan()).then(() => status('Defaults back, re-planned')).catch(() => {}); } else status('Defaults back'); });
    const copy = make('button', { type: 'button', id: 'devCopy', textContent: 'Copy debug JSON' });
    copy.addEventListener('click', () => copyJSON());
    const closeB = make('button', { type: 'button', id: 'devClose', textContent: 'Close' });
    closeB.addEventListener('click', close);
    const st = make('span', { id: 'devStatus', className: 'dv-mut', role: 'status', textContent: lastStatus });
    panel.append(make('div', { className: 'dv-head' }, make('b', { textContent: 'Dev' }), make('span', {}, replan, reset, copy, closeB)), make('div', {}, over, ' · ', st));

    // the switches
    panel.append(make('h4', { textContent: 'Switches' }));
    for (const [k, label, note] of SWITCHES) {
      const box = make('input', { type: 'checkbox', checked: !!s[k] });
      box.dataset.dev = k;
      box.addEventListener('change', () => {
        const next = { [k]: box.checked };
        if (box.checked && k === 'forceOwn') next.forceValhalla = false;
        if (box.checked && k === 'forceValhalla') next.forceOwn = false;
        save(next); render();
      });
      panel.append(make('label', {}, box, ` ${label} `, make('span', { className: 'dv-mut', textContent: note })));
    }

    // the plan
    panel.append(make('h4', { textContent: 'Last plan' }));
    if (!sum) panel.append(make('div', { className: 'dv-mut', id: 'devNoPlan', textContent: 'No plan yet: plan a trip, then open this again.' }));
    else {
      const o = sum.own || {};
      panel.append(make('div', { id: 'devPlanHead', textContent: `${sum.at} · level ${sum.level} · budget ${sum.limitS != null ? (sum.limitS / 60).toFixed(1) + ' min' : '--'} · own router ${o.used ? 'used' : o.covered ? 'failed' : o.reason || '--'}`
        + ` (a ${num(o.a, 2)}, router ${o.routerMs != null ? o.routerMs + ' ms' : '--'}, view ${o.viewMs != null ? o.viewMs + ' ms' : '--'}${o.partial ? ', partial' : ''})`
        + (sum.refined ? ` · ranked again with the fresh context in ${sum.refined.ms} ms: ${sum.refined.swapped ? 'swapped' : 'kept the card\'s route'}` : '') }));
      panel.append(make('div', { id: 'devPlanTune', className: 'dv-mut', textContent: sum.tune ? `planned with ${Object.entries(sum.tune).flatMap(([t, m]) => Object.entries(m || {}).map(([p, v]) => `${t}.${p}=${v}`)).join(', ')}` : 'planned with the defaults' }));
      for (const c of sum.cands) {
        const r = c.router;
        const box = make('div', { className: 'dv-c' + (c.picked ? ' pick' : '') });
        box.dataset.n = String(c.n);
        box.append(make('div', {}, make('span', { className: 'dv-sw', style: `background:${c.colour}` }),
          make('b', { textContent: `#${c.n} ${c.source}` }), ` · ${num(c.min)} min · ${num(c.km)} km · hwy ${num(c.hwyKm)} km · value ${num(c.value)}`));
        if (r) box.append(make('div', { className: 'dv-mut', textContent: `router: ${r.role || '--'} · G ${num(r.G, 3)} · a ${num(r.a, 2)} · side street ${num(r.poorKm)} km · good road ${num(r.goodKm)} km` }));
        if (c.parts) box.append(make('div', { textContent: Object.entries(c.parts).filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' · ') || 'all parts 0' }));
        box.append(make('div', { className: 'dv-why', textContent: c.why }));
        panel.append(box);
      }
      const tl = make('details', {}, make('summary', { textContent: `Timeline (${sum.timeline.length} steps, ms from the plan's start)` }));
      for (const [k, a, b] of sum.timeline.slice().sort((x, y) => x[1] - y[1])) tl.append(make('div', { className: 'dv-k' }, make('span', { textContent: k }), make('span', { textContent: `${a}–${b} (${b - a})` })));
      for (const [k, ms] of sum.planMarks) tl.append(make('div', { className: 'dv-k dv-mut' }, make('span', { textContent: `mark ${k}` }), make('span', { textContent: `${ms}` })));
      panel.append(tl);
    }
    const ver = make('div', { id: 'devVersions', className: 'dv-mut', textContent: 'versions…' });
    panel.append(make('h4', { textContent: 'Versions' }), ver);
    Promise.resolve(host.versions()).then((v) => { ver.textContent = JSON.stringify(v); }).catch(() => { ver.textContent = '--'; });

    // the tunables
    panel.append(make('h4', { textContent: 'Tunables (edit, then Re-plan)' }));
    for (const [t, title] of TABLES) {
      const d = defs[t] || {}, cur = pending[t] || {};   // (what's typed and not yet applied stays through a redraw)
      const sec = make('details', { open: t === 'router' || t === 'engine' || t === 'levels' }, make('summary', { textContent: title }));
      for (const p of KEY_KNOBS[t]) if (p in d) sec.append(knobRow(t, p, d[p], cur[p], pending));
      const rest = Object.keys(d).filter((p) => !KEY_KNOBS[t].includes(p));
      if (rest.length) {
        const all = make('details', {}, make('summary', { textContent: `All (${rest.length} more)` }));
        for (const p of rest) all.append(knobRow(t, p, d[p], cur[p], pending));
        sec.append(all);
      }
      panel.append(sec);
    }
    panel.append(make('textarea', { id: 'devJSON', hidden: true, readOnly: true }));
  }
  const clean = (t) => Object.fromEntries(Object.entries(t || {}).filter(([, m]) => m && Object.keys(m).length));
  function save(patch) {
    if (!allowed()) return;
    host.save({ ...(host.settings() || {}), ...patch });
    applySwitches();
  }
  let lastStatus = '';
  function status(t) { lastStatus = t; const n = panel && panel.querySelector('#devStatus'); if (n) n.textContent = t; }
  function dump() {
    const s = host.settings() || {};
    return { app: 'Vetta dev mode', plan: summarize(host.plan()), tune: s.tune || {}, switches: { forceOwn: !!s.forceOwn, forceValhalla: !!s.forceValhalla, offline: !!s.offline, lines: !!s.lines } };
  }
  async function copyJSON() {
    if (!allowed()) return;
    const d = dump();
    try { d.versions = await host.versions(); } catch (_) { d.versions = null; }
    const text = JSON.stringify(d, null, 1), ta = panel.querySelector('#devJSON');
    ta.value = text;
    let ok = false;
    try { if (root.navigator.clipboard && root.navigator.clipboard.writeText) { await root.navigator.clipboard.writeText(text); ok = true; } } catch (_) { ok = false; }
    if (!ok) { ta.hidden = false; ta.focus(); ta.select(); try { ok = doc().execCommand('copy'); } catch (_) { ok = false; } }
    status(ok ? `Copied ${Math.round(text.length / 1024)} KB` : 'Select the text below and copy it');
    if (ok) ta.hidden = true;
  }
  function open() {
    if (!allowed()) return false;
    if (!panel) {
      doc().head.append(make('style', { id: 'devPanelCss', textContent: CSS }));
      panel = make('aside', { id: 'devPanel', hidden: true });
      panel.setAttribute('aria-label', 'Dev panel');
      doc().body.append(panel);
    }
    pending = JSON.parse(JSON.stringify((host.settings() || {}).tune || {}));
    render();
    panel.hidden = false;
    return true;
  }
  function close() { if (panel) panel.hidden = true; }
  /** A plan has finished (cockpit.js funRoute): the lines and the open panel show it. */
  function planned() { if (!allowed()) return; drawLines(); if (panel && !panel.hidden) render(); }
  /** No longer a developer (signed out, another account): the panel, its switches and their effects all go. */
  function unmount() {
    close();
    setOffline(false);
    const map = host && host.map;
    try { if (map && map.getLayer(LINES)) map.removeLayer(LINES); if (map && map.getSource(LINES)) map.removeSource(LINES); } catch (_) {}
    if (panel) { panel.remove(); panel = null; }
  }
  function mount(h) { host = h; applySwitches(); return api; }

  const api = { mount, open, close, planned, unmount, summarize, dump, KEY_KNOBS, COLOURS, isOpen: () => !!(panel && !panel.hidden) };
  root.ApexDevPanel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
