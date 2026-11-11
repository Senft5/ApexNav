// ApexWhenToGo — when a route is best driven (docs/ROUTING.md "When to go").
// A planned route is scored for the hour you leave: the sun in your eyes, daylight on the scenery, the forecast, deer
// hours, school runs, events, road works and timed closures all move with the clock. This drives the same route at every
// half hour of the next day and says how each departure compares, with the route engine's own model: the corridor is
// shifted in time, the providers that bake the hour into their answers (conditions, wildlife, events, hazards-live) are
// asked again for every departure at once (the forecast is cached per cell for three days ahead, so this costs no new
// request after a plan), and ApexRouteEngine.evaluate gives each departure its penalties, bonuses and hard constraints.
// Nothing here is a second model, with one addition said plainly: scenery you drive past in the dark isn't seen, so the
// route's scenery points count by the share of it driven in daylight or twilight.
// A forecast is a forecast: a departure whose weather isn't known (offline, past the forecast) says so and is never
// called the best time on what isn't known (CLAUDE.md rule 3).
(function (root) {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const need = (name, path) => root[name] || (NODE ? (() => { try { return require(path); } catch (_) { return null; } })() : null);
  const Ctx = () => need('ApexRouteCtx', './route_ctx/registry.js');
  const Engine = () => need('ApexRouteEngine', './route_engine.js');
  const Fun = () => need('ApexFunRoute', './fun_route.js');
  const Wx = () => need('ApexRouteWeather', './route_weather.js');
  const Util = () => need('ApexRouteCtxUtil', './route_ctx/ctx_util.js');

  // The providers whose answers hold the hour (they read corridor.etaAt): asked again for every departure.
  const TIMED = ['conditions', 'wildlife', 'events', 'hazards-live'];
  const HORIZON_H = 24, STEP_MIN = 30, LONG_KM = 150, LONG_STEP_MIN = 60, BUDGET_MS = 6000;
  const WAKING = [6, 22];             // "the best time" is one you'd be up for: departures from 06:00 to 22:00 local
  const BETTER = 3;                   // points a departure must gain on leaving now to be worth saying
  const SOON_H = 3, DROP = 4;         // "leave by": the value falls this much within these hours
  const HAZARD = ['none', 'heat', 'fog', 'rain', 'storm', 'snow', 'ice'];       // conditions.js wx_hazard codes
  const WX_WORDS = { ice: 'ice risk', snow: 'snow', storm: 'thunderstorms', rain: 'rain likely', fog: 'fog', heat: 'very hot' };
  const WX_ORDER = ['ice', 'snow', 'storm', 'rain', 'fog', 'heat'];
  // The engine's penalty labels as a driver would say them: [gone, less of it, there].
  const PEN_WORDS = { deer: ['outside deer hours', 'fewer deer about', 'deer hour'], 'school zone': ['no school run', 'less of the school run', 'school run'],
    'cold road': ['a warmer road', 'a warmer road', 'cold road'], 'road works': ['road works finished', 'less road works', 'road works'],
    'busy at that hour': ['a quiet hour', 'a quieter hour', 'a busy hour'], 'unlit at night': ['no unlit road in the dark', 'less unlit road in the dark', 'unlit road in the dark'] };
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** The departures looked at: now, then every `stepMin` on the clock up to `horizonH` ahead (one within 10 min of now is skipped). */
  function slotTimes(now, o = {}) {
    const step = (o.stepMin || STEP_MIN) * 60e3, end = now + (o.horizonH || HORIZON_H) * 3600e3, out = [now];
    for (let t = Math.ceil((now + 1) / step) * step; t <= end; t += step) if (t - now >= 10 * 60e3) out.push(t);
    return out;
  }
  /** The same corridor driven from `at`: every sample's eta moved by the same amount (the router's clock is kept). */
  function shift(c, id, at) {
    const d = at - c.departAt, etaAt = new Float64Array(c.etaAt.length);
    for (let i = 0; i < etaAt.length; i++) etaAt[i] = c.etaAt[i] + d;
    return { ...c, id, departAt: at, etaAt };
  }
  /**
   * A route's context at another hour: `base` (the plan's) without what the timed providers baked in for the plan's hour,
   * with their answer for this one (`timed`) in its place. A timed provider that didn't answer leaves its channels
   * unknown: never the other hour's values.
   */
  function overlay(base, timed, timedIds, owned) {
    const channels = {}, from = {};
    for (const [k, v] of Object.entries((base && base.channels) || {})) {
      const src = (base.from && base.from[k]) || [];
      if (src.length ? src.every((id) => timedIds.includes(id)) : owned.has(k)) continue;
      channels[k] = v; from[k] = src.filter((id) => !timedIds.includes(id));
    }
    for (const [k, v] of Object.entries((timed && timed.channels) || {})) {
      if (!channels[k]) { channels[k] = v; from[k] = (timed.from && timed.from[k]) || []; continue; }
      const m = Float32Array.from(v), b = channels[k];                       // two sources: this hour's first, the map's under it
      for (let i = 0; i < m.length; i++) if (Number.isNaN(m[i])) m[i] = b[i];
      channels[k] = m;
    }
    const keep = (x) => !timedIds.includes(x.source);
    return { channels, from, spans: [...((base && base.spans) || []).filter(keep), ...((timed && timed.spans) || [])].sort((a, b) => a.fromM - b.fromM),
      points: [...((base && base.points) || []).filter(keep), ...((timed && timed.points) || [])].sort((a, b) => a.atM - b.atM) };
  }

  /** Minutes into a low sun on a corridor (the R-13 cone, conditions.js `glare`), by its own clock; null when the sun isn't known. */
  function glareMinutes(c, ctx) {
    const g = ctx && ctx.channels && ctx.channels.glare;
    if (!g) return null;
    let ms = 0, known = false;
    for (let i = 0; i + 1 < g.length; i++) { if (Number.isFinite(g[i])) known = true; if (g[i] >= 0.5) ms += c.etaAt[i + 1] - c.etaAt[i]; }
    return known ? ms / 60e3 : null;
  }
  /** Shares of the route by light and by forecast hazard at the time you'd be there: { dark, twilight, lightKnown, wx: { rain: 0.4 }, wxKnown, tempC }. */
  function sky(ctx) {
    const ch = (ctx && ctx.channels) || {}, light = ch.light, hz = ch.wx_hazard, air = ch.air_temp_c;
    const out = { dark: null, twilight: null, lightKnown: 0, wx: {}, wxKnown: 0, tempC: null };
    if (light) {
      let d = 0, t = 0, k = 0;
      for (let i = 0; i < light.length; i++) { if (!Number.isFinite(light[i])) continue; k++; if (light[i] === 0) d++; else if (light[i] === 1) t++; }
      if (k) { out.dark = d / k; out.twilight = t / k; out.lightKnown = k / light.length; }
    }
    if (hz) {
      let k = 0; const n = {};
      for (let i = 0; i < hz.length; i++) { if (!Number.isFinite(hz[i])) continue; k++; const h = HAZARD[Math.round(hz[i])]; if (h && h !== 'none') n[h] = (n[h] || 0) + 1; }
      out.wxKnown = k / hz.length;
      for (const [h, v] of Object.entries(n)) out.wx[h] = v / k;
    }
    if (air) { let a = 0, k = 0; for (let i = 0; i < air.length; i++) if (Number.isFinite(air[i])) { a += air[i]; k++; } if (k) out.tempC = a / k; }
    return out;
  }
  /** What the forecast costs (route_weather.js COST by the share of the route in it; fog is the engine's own per-km term). */
  function weatherCost(s) {
    const W = Wx(), COST = (W && W.COST) || {};
    let c = 0;
    for (const [h, share] of Object.entries(s.wx)) if (h !== 'fog') c += (COST[h] || 0) * share;
    return c;
  }

  /** One departure, valued: the parts of the route's value that move with the clock (points; higher is better). */
  function value(cand, c, ctx, o = {}) {
    const E = Engine(), F = Fun();
    const ev = E.evaluate({ corridor: c, ctx, fun: cand.fun || null }, { prefs: o.prefs || {}, perMin: o.perMin, car: o.car || null, samples: o.samples });
    const s = sky(ctx);
    let glareMin = glareMinutes(c, ctx);
    if (glareMin == null && F && F.glare && cand.t && finite(cand.timeS)) { const g = F.glare(cand.t, cand.timeS, new Date(c.departAt)); glareMin = g ? g.minutes : null; }
    const scenery = Math.max(0, ev.sceneryPts || 0);
    const parts = { bonus: ev.bonusPts || 0, penalty: -(ev.penaltyPts || 0), glare: -(F ? F.glareCost({ glare: { minutes: glareMin || 0 } }) : Math.min(20, glareMin || 0)),
      weather: -weatherCost(s), daylight: s.dark != null ? -scenery * s.dark : 0 };
    return { at: c.departAt, arriveAt: finite(cand.timeS) ? c.departAt + cand.timeS * 1000 : c.etaAt[c.etaAt.length - 1], value: Object.values(parts).reduce((a, b) => a + b, 0), parts,
      hard: ev.hard.map((h) => h.label), penalties: ev.penalties.map((p) => ({ label: p.label, points: p.points })), bonuses: ev.bonuses.map((b) => ({ label: b.label, points: b.points })),
      glareMin, dark: s.dark, twilight: s.twilight, wx: s.wx, wxKnown: s.wxKnown, tempC: s.tempC, samples: ev.samples };
  }

  /**
   * Scores `cand` ({ corridor, ctx, t?, timeS, fun? }: a ranked candidate as the planner keeps it) for every departure in
   * the next `horizonH` hours. Resolves to { slots: [slot], now: slot, forecast: bool, status } or null when the route has
   * no context to move. opts: { now, horizonH, stepMin, prefs, car, perMin, settings, providerOpts, budgetMs, signal }.
   */
  async function scan(cand, o = {}) {
    const C = Ctx(), E = Engine();
    if (!C || !E || !cand || !cand.corridor || !cand.ctx || !cand.corridor.etaAt) return null;
    const c0 = cand.corridor, now = finite(o.now) ? o.now : Date.now();
    const km = (c0.totalM || 0) / 1000;
    const times = slotTimes(now, { horizonH: o.horizonH, stepMin: o.stepMin || (km > LONG_KM ? LONG_STEP_MIN : STEP_MIN) });
    const cs = times.map((at, k) => shift(c0, `when${k}`, at));
    const have = C.list().filter((p) => TIMED.includes(p.id));
    const timedIds = TIMED.slice(), owned = new Set(have.flatMap((p) => p.channels));
    let res = { byId: {}, status: {} };
    if (have.length) {
      const inputs = C.inputsFor(cs, { byId: Object.fromEntries(cs.map((c) => [c.id, cand.ctx])) });
      res = await C.run(cs, { only: have.map((p) => p.id), inputs, budgetMs: o.budgetMs || BUDGET_MS, settings: o.settings || {}, signal: o.signal,
        providerOpts: { waitMs: 2500, ...(o.providerOpts || {}) } });
    }
    // the road is the same at every hour: its quality and scenery per sample are worked out once (leaving now) and kept;
    // the page gets a breath between departures (o.breathe), so a long route never holds a frame
    const slots = [];
    let samples = null;
    for (const c of cs) {
      const s = value(cand, c, overlay(cand.ctx, res.byId[c.id], timedIds, owned), { ...o, samples });
      samples = samples || s.samples;
      delete s.samples;
      slots.push(s);
      if (typeof o.breathe === 'function') await o.breathe();
      if (o.signal && o.signal.aborted) return null;
    }
    const U = Util();
    for (const s of slots) {
      const lt = U && U.localTime ? U.localTime(s.at, c0.lat[0], c0.lon[0]) : null;
      s.hour = lt ? lt.hour : new Date(s.at).getHours() + new Date(s.at).getMinutes() / 60;
      s.waking = s.hour >= WAKING[0] && s.hour <= WAKING[1];
    }
    const nowSlot = slots[0];
    for (const s of slots) s.delta = s.value - nowSlot.value;
    return { slots, now: nowSlot, forecast: nowSlot.wxKnown >= 0.5, status: res.status };
  }

  // ---- words ----------------------------------------------------------------------------------------------------------
  const worstWx = (s) => WX_ORDER.find((h) => (s.wx[h] || 0) >= 0.15) || null;
  /** A departure in a few plain words: the forecast, the light, what's in the way. `ref`: say only what differs from it. */
  function reasons(s, ref = null) {
    const out = [], w = worstWx(s), rw = ref ? worstWx(ref) : undefined;
    const pts = (list, label) => { const p = (list || []).find((x) => x.label === label); return p ? p.points : 0; };
    if (s.hard.length) out.push(`${s.hard[0]}`);
    if (ref) {
      if (w !== rw && s.wxKnown >= 0.5 && ref.wxKnown >= 0.5) out.push(w ? WX_WORDS[w] : `no ${WX_WORDS[rw].replace(' likely', '').replace(' risk', '')}`);
      const labels = new Set([...s.penalties, ...ref.penalties].map((p) => p.label));
      const moved = [...labels].map((l) => ({ l, d: pts(s.penalties, l) - pts(ref.penalties, l), mine: pts(s.penalties, l) })).filter((x) => Math.abs(x.d) >= 1).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
      for (const m of moved.slice(0, 2)) { const w3 = PEN_WORDS[m.l] || [`no ${m.l}`, `less ${m.l}`, m.l]; out.push(m.d < 0 ? (m.mine < 0.3 ? w3[0] : w3[1]) : w3[2]); }
      const g = (s.glareMin || 0) - (ref.glareMin || 0);
      if (Math.abs(g) >= 3) out.push(g < 0 ? ((s.glareMin || 0) < 1 ? 'no low sun ahead' : 'less low sun ahead') : `${Math.round(s.glareMin)} min into a low sun`);
      if (s.dark != null && ref.dark != null && Math.abs(s.dark - ref.dark) >= 0.3) out.push(s.dark < ref.dark ? 'in daylight' : 'after dark');
      const gold = pts(s.bonuses, 'golden light') - pts(ref.bonuses, 'golden light');
      if (gold >= 0.5) out.push('golden light');
    } else {
      if (s.wxKnown >= 0.5) out.push(w ? WX_WORDS[w] : 'dry');
      if (s.dark != null) out.push(s.dark >= 0.7 ? 'dark' : s.dark >= 0.2 ? 'dark for part of it' : (s.twilight || 0) >= 0.5 ? 'twilight' : 'daylight');
      if ((s.glareMin || 0) >= 3) out.push(`${Math.round(s.glareMin)} min into a low sun`);
      if (pts(s.bonuses, 'golden light') >= 0.5) out.push('golden light');
      for (const p of s.penalties.filter((x) => x.points >= 1).slice(0, 2)) out.push((PEN_WORDS[p.label] || [0, 0, p.label])[2]);
    }
    return out;
  }
  /**
   * What to tell the driver: { kind: 'better' | 'by' | 'now' | 'closed' | 'unknown', slot?, text }. `fmt.time(ms)` formats a
   * clock time for the page. Only waking-hour departures with a known forecast (when now has one) can be "better".
   */
  function advice(sc, fmt = {}) {
    if (!sc || !sc.slots || !sc.slots.length) return null;
    const time = fmt.time || ((ms) => new Date(ms).toISOString().slice(11, 16));
    const now = sc.now, ok = (s) => !s.hard.length && s.waking && (!sc.forecast || s.wxKnown >= 0.5);
    const cands = sc.slots.slice(1).filter(ok);
    const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
    if (now.hard.length) {
      const open = cands[0];
      return { kind: 'closed', slot: open || null, text: open ? `${cap(now.hard[0])} if you leave now. Open from ${time(open.at)}.` : `${cap(now.hard[0])} if you leave now, and for the next day.` };
    }
    const best = cands.reduce((a, b) => (b.value > a.value + 0.25 ? b : a), cands[0] || now);
    if (best !== now && best.value - now.value >= BETTER) {
      const why = reasons(best, now).slice(0, 3);
      return { kind: 'better', slot: best, gain: best.value - now.value, text: `Better at ${time(best.at)}${why.length ? `: ${why.join(', ')}` : ''}` };
    }
    // good now, worse soon: the last departure before the value falls, and what arrives
    const soon = sc.slots.slice(1).filter((s) => s.at - now.at <= SOON_H * 3600e3);
    const k = soon.findIndex((s) => now.value - s.value >= DROP || s.hard.length);
    if (k >= 0) {
      // the last departure still as good as now (not the half-hour the rain is already arriving in)
      let last = now;
      for (let j = 0; j < k; j++) if (now.value - soon[j].value < DROP / 3 && !soon[j].hard.length) last = soon[j]; else break;
      const bad = soon[k], why = reasons(bad, now).slice(0, 2);
      return { kind: 'by', slot: last, text: `${last === now ? 'Go now' : `Leave by ${time(last.at)}`}${why.length ? `: ${why.join(', ')} after` : ': it gets worse after'}` };
    }
    return { kind: 'now', slot: now, text: sc.forecast ? 'No better time to leave in the next day' : 'No better time by the sun and the calendar (no forecast)' };
  }
  /** Each slot's bar height 0.15–1 for the ribbon: the scan's own range, so the best departure is the tallest; closed = 0. */
  function heights(sc) {
    const open = sc.slots.filter((s) => !s.hard.length), lo = Math.min(...open.map((s) => s.value)), hi = Math.max(...open.map((s) => s.value));
    return sc.slots.map((s) => (s.hard.length ? 0 : hi - lo < 1 ? 0.6 : 0.15 + 0.85 * (s.value - lo) / (hi - lo)));
  }

  const api = { TIMED, HORIZON_H, STEP_MIN, WAKING, BETTER, slotTimes, shift, overlay, glareMinutes, sky, weatherCost, value, scan, reasons, advice, heights };
  if (NODE) module.exports = api;
  root.ApexWhenToGo = api;
})(typeof window !== 'undefined' ? window : globalThis);
