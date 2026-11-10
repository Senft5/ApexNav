// ApexRouteStory — "What this drive is like": a planned route in 3-5 plain lines a driver would say (the owner,
// 2026-11-09: "can we compile the data used to give some kind of route overview for the type of drive it will be? in
// plain english for the user").
//
// Pure: build(ranked, opts) reads what the route engine already holds for a ranked candidate (route_engine.js rank: its
// corridor's 25 m samples, the route context's channels, spans and points, the evaluation `ev` with per-sample quality,
// penalties at the hour you'd be there, the hard list) plus the track's corners and the street names of its steps. No
// network, no clock, no storage. Returns { lines: [{ kind, text, facts }], coverage }: the lines in order (character,
// highlight, slow parts, members, conditions) and the numbers behind each, so a later "customise" can reuse them.
//
// Unknown stays unsaid (CLAUDE.md rule 3): every claim needs its channel known over enough of the distance it speaks
// for (T below); a line whose data is thin is dropped, never guessed. "Country" needs two place signals saying open
// ground (the road class alone can't tell a tertiary road in town from one in fields); limits are posted or measured
// ones only (the class estimate is not a limit); members' words need 500 m measured on that road.
(function (root) {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const Engine = () => root.ApexRouteEngine || (NODE ? require('./route_engine.js') : null);
  const Grid = () => root.ApexContextGrid || (NODE ? (() => { try { return require('./route_ctx/context_grid.js'); } catch (_) { return null; } })() : null);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  // How much must be known before a line may speak (shares of the distance it speaks for), and what counts.
  const T = {
    LEAD_KNOWN: 0.6,        // the setting (country, suburbs, town, highway) known over this share of the route
    MOSTLY: 0.6,            // "Mostly X" from this share of the known distance
    MIX_MIN: 0.2,           // a setting named in a mix from this share
    SPEED_KNOWN: 0.5,       // posted or measured limits over this share of the stretch the speed is said for
    COVER_KNOWN: 0.5,       // land cover known over this share of the country samples
    COVER_SHARE: 0.25,      // ... and woods, farmland or water over this share of them
    Q_KNOWN: 0.5,           // road quality known over this share of the route before naming "the best part"
    GOOD_Q: 0.55,           // a good sample (the engine's good road ramps from 0.5 to 0.65) ...
    GOOD_Q_HI: 0.65,        // ... and a fully good one, looked for first
    GAP_M: 100,             // a run of good road bridges gaps up to this long
    HIGHLIGHT_MIN_M: 1500,  // the best part is at least this long
    HIGHLIGHT_ALL: 0.85,    // ... and "nearly all the way" from this share of the route
    CORNER_M: 25,           // a corner in a run counts as this many metres of good road when runs are compared
    NAME_SHARE: 0.25,       // a road named in a stretch carries this share of it
    NAMES_KNOWN: 0.5,       // names known over this share of a stretch before any is said
    NAMES_WHOLE: 0.75,      // "N miles of A and B Road" only when those roads carry this share of the stretch ...
    INCLUDE_MIN_M: 800,     // ... else "N miles of good road, including A": a road with at least this much of it
    SLOW_MIN_M: 800,        // town and suburbs said from this long ...
    SLOW_MIN_SHARE: 0.08,   // ... or this share of the route (and 400 m)
    SIDE_MIN_KM: 0.4,       // side streets said from this long
    END_SHARE: 0.15,        // "at the start" / "at the end": within this share of either end
    CROWD_MIN_M: 500,       // members' words on a road need this much of it measured
    PEN_MIN: 0.5,           // a condition the engine costs at least this many points at the hour you'd be there
    WET_KNOWN: 0.5,         // rain in the last 6 h known over this share ...
    WET_SHARE: 0.3,         // ... and 1 mm or more over this share of what is known
    DARK_SHARE: 0.5,        // "after dark" when this share of the drive is in the dark
  };

  // ---- words --------------------------------------------------------------------------------------------------------
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  /** A distance as a driver says it: "0.8 miles", "1.5 miles", "6 miles"; "2.5 km", "12 km". */
  function dist(m, metric) {
    const v = metric ? m / 1000 : m / 1609.344;
    const r = v < 0.95 ? Math.max(0.1, Math.round(v * 10) / 10) : v < 3 ? Math.round(v * 2) / 2 : Math.round(v);
    return `${r} ${metric ? 'km' : r === 1 ? 'mile' : 'miles'}`;
  }
  /** A limit range as the why line rounds it: "45–55 mph", "70–90 km/h". */
  function speed(lo, hi, metric) {
    const r = (kph) => Math.round((metric ? kph : kph / 1.609344) / 5) * 5;
    const a = r(lo), b = r(hi), u = metric ? 'km/h' : 'mph';
    return a === b ? `${a} ${u}` : `${a}–${b} ${u}`;
  }
  /** "Struble and Day Road" for two names with the same last word, else "Struble Road and Day Road". */
  function roadNames(names) {
    if (names.length !== 2) return names.join('');
    const a = names[0].split(/\s+/), b = names[1].split(/\s+/);
    if (a.length > 1 && b.length > 1 && a[a.length - 1].toLowerCase() === b[b.length - 1].toLowerCase()) return `${a.slice(0, -1).join(' ')} and ${names[1]}`;
    return `${names[0]} and ${names[1]}`;
  }
  const quantile = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

  // ---- the route's own pieces ---------------------------------------------------------------------------------------
  /** Street names along the route, [{ fromM, toM, name }], from the track's steps ({ m, street }) or corridor edges. */
  function namesAlong(steps, edges, totalM) {
    const out = [];
    if (Array.isArray(steps) && steps.length) {
      const s = steps.filter((x) => x && finite(x.m)).slice().sort((a, b) => a.m - b.m);
      for (let k = 0; k < s.length; k++) {
        const to = k + 1 < s.length ? s[k + 1].m : totalM;
        if (to > s[k].m) out.push({ fromM: s[k].m, toM: to, name: typeof s[k].street === 'string' && s[k].street.trim() ? s[k].street.trim() : null });
      }
    } else if (Array.isArray(edges)) {
      for (const e of edges) if (e && finite(e.fromM) && finite(e.toM)) out.push({ fromM: e.fromM, toM: e.toM, name: (e.name || (Array.isArray(e.names) && e.names[0]) || null) });
    }
    return out;
  }
  function nameAt(names, m) {
    for (const n of names) if (m >= n.fromM && m < n.toM) return n.name;
    return null;
  }
  /** The names that carry a stretch: each with NAME_SHARE of it, in the order driven, at most two; [] when too few are known. */
  function namesIn(names, a, b) {
    const len = Math.max(1, b - a), by = new Map();
    let known = 0;
    for (const n of names) {
      const o = Math.max(0, Math.min(b, n.toM) - Math.max(a, n.fromM));
      if (!o || !n.name) continue;
      known += o;
      const x = by.get(n.name) || { name: n.name, m: 0, first: n.fromM };
      x.m += o; by.set(n.name, x);
    }
    if (known < T.NAMES_KNOWN * len) return [];
    return [...by.values()].filter((x) => x.m >= T.NAME_SHARE * len).sort((x, y) => y.m - x.m).slice(0, 2).sort((x, y) => x.first - y.first).map((x) => x.name);
  }
  /**
   * How a stretch is named: { names, whole }. `whole`: the one or two roads with NAME_SHARE each carry NAMES_WHOLE of it
   * ("6 miles of Chapel and California Road"). Else the stretch runs over more roads than can be said: its one or two
   * longest (INCLUDE_MIN_M each), for "7 miles of good road, including Millville Shandon Road" (on the public Oxford
   * trip the 7 miles were five roads and the one named carried 3 of them). [] when too few names are known.
   */
  function namesFor(names, a, b) {
    const len = Math.max(1, b - a), by = new Map();
    let known = 0;
    for (const n of names) {
      const o = Math.max(0, Math.min(b, n.toM) - Math.max(a, n.fromM));
      if (!o || !n.name) continue;
      known += o;
      const x = by.get(n.name) || { name: n.name, m: 0, first: n.fromM };
      x.m += o; by.set(n.name, x);
    }
    if (known < T.NAMES_KNOWN * len) return { names: [], whole: false };
    const order = (xs) => xs.sort((x, y) => x.first - y.first).map((x) => x.name);
    const big = [...by.values()].filter((x) => x.m >= T.NAME_SHARE * len).sort((x, y) => y.m - x.m).slice(0, 2);
    if (big.length && big.reduce((s, x) => s + x.m, 0) >= T.NAMES_WHOLE * len) return { names: order(big), whole: true };
    const top = [...by.values()].filter((x) => x.m >= T.INCLUDE_MIN_M).sort((x, y) => y.m - x.m).slice(0, 2);
    return { names: order(top), whole: false };
  }
  const isTight = (e) => e.severity === 'HP' || (Number(e.severity) >= 1 && Number(e.severity) <= 2);
  function cornersIn(events, a, b) {
    const cs = (events || []).filter((e) => e && e.type === 'corner' && finite(e.dist_m) && e.dist_m >= a && e.dist_m <= b);
    return { n: cs.length, tight: cs.filter((e) => isTight(e) && e.severity !== 'HP').length, hairpins: cs.filter((e) => e.severity === 'HP').length };
  }

  // Place signals (how built-up the ground beside the road is) and the way each reads 0 open … 1 built
  const PLACE = [['density', (v) => clamp01((v - 2) / 5)], ['housing_per_km2', (v) => clamp01(v / 500)], ['impervious_pct', (v) => clamp01((v - 8) / 25)],
    ['address_per_km', (v) => clamp01(v / 50)], ['address_density', (v) => clamp01(v / 600)], ['bldg_per_km', (v) => clamp01(v / 50)],
    ['landuse_residential', (v) => clamp01(v / 0.6)], ['landuse_urban', (v) => clamp01(v / 0.4)], ['business_per_km', (v) => clamp01(v / 8)],
    ['night_lights', (v) => clamp01((v - 0.15) / 0.45)]];

  /**
   * Each 25 m sample's setting: 'highway' (motorway, trunk or a ramp), 'town' (built and busy: shops, urban land, dense, or
   * signals), 'suburban' (built), 'country' (two or more place signals, none built), or null (not known).
   */
  function settings(ctx, n) {
    const E = Engine(), ch = (k) => (E && ctx ? E.channel(ctx, k) : null);
    const rc = ch('road_class'), use = ch('road_use'), walk = ch('sidewalk'), biz = ch('business_per_km'), urb = ch('landuse_urban'), dens = ch('density'),
      imp = ch('impervious_pct'), sig = ch('signals_per_km');
    const place = PLACE.map(([k, f]) => [ch(k), f]).filter(([v]) => v);
    const out = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if ((rc && rc[i] <= 1) || (use && use[i] === 1)) { out[i] = 'highway'; continue; }
      // how built it reads: the second-highest of the signals known there, so no one signal decides alone (night lights
      // glow a mile past a city's edge, buildings per km count a farm's barns; fitted on the public Cincinnati trips,
      // 2026-11-09). With one signal known, that one: it can say built, never country (which needs two).
      let b1 = -1, b2 = -1, k = 0;
      const see = (x) => { if (x > b1) { b2 = b1; b1 = x; } else if (x > b2) b2 = x; k++; };
      for (const [v, f] of place) if (finite(v[i])) see(f(v[i]));
      if (walk && finite(walk[i])) see(walk[i] >= 0.5 ? 0.6 : 0);
      const b = k >= 2 ? b2 : b1;
      if (b >= 0.5) {
        const busy = (biz && biz[i] >= 4) || (urb && urb[i] >= 0.3) || (dens && dens[i] >= 8) || (imp && imp[i] >= 40) || (sig && sig[i] >= 2);
        out[i] = busy ? 'town' : 'suburban';
      } else if (k >= 2) out[i] = b < 0.35 ? 'country' : 'suburban';
    }
    return out;
  }
  /** Contiguous runs of samples where ok(i), gaps up to GAP_M bridged: [{ a, b }] (sample indices). */
  function runs(n, step, ok) {
    const out = [];
    let cur = null, gap = 0;
    for (let i = 0; i < n; i++) {
      if (ok(i)) { if (cur) cur.b = i; else cur = { a: i, b: i }; gap = 0; }
      else if (cur) { gap += step; if (gap > T.GAP_M) { out.push(cur); cur = null; gap = 0; } }
    }
    if (cur) out.push(cur);
    return out;
  }

  /** Where the traffic signals are (metres along), from the context's points; duplicates across providers within 40 m once. */
  function signalsAt(ctx) {
    const ms = [...(ctx.points || []), ...(ctx.spans || [])].filter((p) => p && p.kind === 'signal').map((p) => (finite(p.atM) ? p.atM : p.fromM)).filter(finite).sort((a, b) => a - b);
    const out = [];
    for (const m of ms) if (!out.length || m - out[out.length - 1] > 40) out.push(m);
    return out;
  }

  // ---- the lines ----------------------------------------------------------------------------------------------------
  const NOUN = { country: 'country roads', suburban: 'suburbs', town: 'town', highway: 'highway' };
  function leadLine(S, o) {
    const { set, n, step, ch, metric } = S;
    const m = { country: 0, suburban: 0, town: 0, highway: 0 };
    let known = 0;
    for (let i = 0; i < n; i++) if (set[i]) { m[set[i]] += step; known += step; }
    const total = n * step;
    const share = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, known ? v / known : 0]));
    const top = Object.keys(m).sort((a, b) => m[b] - m[a]);
    // speeds: posted or measured limits where the typical drive is (off the highway unless it's mostly highway)
    const lim = ch('speed_limit_kph');
    const onHwy = top[0] === 'highway' && share.highway >= T.MOSTLY;
    const lims = []; let over = 0;
    for (let i = 0; i < n; i++) {
      if ((set[i] === 'highway') !== onHwy) continue;
      over++;
      if (lim && finite(lim[i]) && lim[i] > 0) lims.push(lim[i]);
    }
    const sp = lims.length && lims.length >= T.SPEED_KNOWN * over ? { loKph: quantile(lims, 0.25), hiKph: quantile(lims, 0.75), known: lims.length / over } : null;
    const facts = { known: known / total, share, speed: sp };
    const spText = sp ? speed(sp.loKph, sp.hiKph, metric) : null;
    if (known < T.LEAD_KNOWN * total) {
      if (!sp || onHwy) return null;
      return { kind: 'character', text: `Limits mostly ${spText}.`, facts };   // the setting too thin to name: the limits alone
    }
    let what;
    if (share[top[0]] >= T.MOSTLY) {
      what = `Mostly ${S.kindWords(top[0])}`;
      if (top[0] === 'country') { const cv = S.cover(); facts.cover = cv; if (cv.text) what += ` ${cv.text}`; }
    } else {
      const named = top.filter((k) => share[k] >= T.MIX_MIN).slice(0, 3);
      if (named.length < 2) return null;
      what = `A mix of ${list(named.map((k) => NOUN[k]))}`;
    }
    return { kind: 'character', text: `${what}${spText ? `, ${spText}` : ''}.`, facts };
  }

  function highlightLine(S, o) {
    const { set, n, step, Q, metric, total } = S;
    let qk = 0;
    for (let i = 0; i < n; i++) if (finite(Q[i])) qk++;
    if (qk < T.Q_KNOWN * n) return null;
    const events = S.events;
    // the engine's full mark for good road first (GOOD_Q_HI), so the best part stands out from a merely decent road; else good
    const runsAt = (lo) => runs(n, step, (i) => finite(Q[i]) && Q[i] >= lo && set[i] !== 'highway' && !S.limited(i)).map((r) => {
      const fromM = S.distM[r.a], toM = Math.min(total, S.distM[r.b] + step);
      let g = 0;
      for (let i = r.a; i <= r.b; i++) if (finite(Q[i])) g += clamp01((Q[i] - 0.5) / 0.15) * step;
      const c = cornersIn(events, fromM, toM);
      return { fromM, toM, m: toM - fromM, score: g + T.CORNER_M * c.n, corners: c };
    }).filter((r) => r.m >= T.HIGHLIGHT_MIN_M);
    let rs = runsAt(T.GOOD_Q_HI);
    if (!rs.length) rs = runsAt(T.GOOD_Q);
    if (!rs.length) return null;
    const best = rs.sort((a, b) => b.score - a.score)[0];
    const named = namesFor(S.names, best.fromM, best.toM), names = named.names;
    const c = best.corners;
    let corners = '';
    if (c.n === 1) corners = `one good corner${c.hairpins ? ', a hairpin' : c.tight ? ', a tight one' : ''}`;
    else if (c.n > 1) {
      const sub = [];
      if (c.tight) sub.push(c.tight === c.n ? 'all of them tight' : `${word(c.tight)} of them tight`);
      if (c.hairpins) sub.push(c.hairpins === 1 ? 'one a hairpin' : `${word(c.hairpins)} hairpins`);
      corners = `${c.n} good corners${sub.length ? `, ${sub.join(' and ')}` : ''}`;
    }
    let text;
    if (best.m >= T.HIGHLIGHT_ALL * total) text = `Good road nearly all the way${names.length && named.whole ?` on ${roadNames(names)}` : ''}${corners ? `: ${corners}` : ''}.`;
    else {
      const where = names.length && named.whole ? `of ${roadNames(names)}` : names.length ? `of good road, including ${roadNames(names)}`
        : `of good road${best.fromM < T.END_SHARE * total ? ' from the start' : `, starting ${dist(best.fromM, metric)} in`}`;
      text = `The best part is ${dist(best.m, metric)} ${where}${corners ? `: ${corners}` : ''}.`;
    }
    return { kind: 'highlight', text, facts: { fromM: best.fromM, toM: best.toM, m: best.m, names, namesWhole: named.whole, corners: c, qualityKnown: qk / n } };
  }

  function slowLine(S, o, lead) {
    const { set, n, step, ch, metric, total, ctx, ev, Q } = S;
    // town, and suburbs the engine doesn't score as good road: houses beside a road it marks GOOD_Q or better (a river
    // road past a hamlet) are not a slow part (the public Harrison trip said "7 miles through suburbs" of a country drive)
    const built = (i) => set[i] === 'town' || (set[i] === 'suburban' && !(finite(Q[i]) && Q[i] >= T.GOOD_Q));
    const rs = runs(n, step, built).map((r) => ({ fromM: S.distM[r.a], toM: Math.min(total, S.distM[r.b] + step), a: r.a, b: r.b }));
    let townM = 0, subM = 0;
    for (let i = 0; i < n; i++) { if (!built(i)) continue; if (set[i] === 'town') townM += step; else subM += step; }
    const builtM = townM + subM;
    // traffic lights: counted only where a source says where they are (OSM or the router's signals, our tiles' nodes)
    const sigCh = ch('signals_per_km'), node = ch('signal_node');
    const sigKnown = (sigCh && Array.from(sigCh).some(finite)) || (node && Array.from(node).some(finite));
    const sigAt = signalsAt(ctx);
    const lightsIn = (a, b) => {
      let k = sigAt.filter((m) => m >= a && m <= b).length;
      if (!k && node) { const i0 = Math.max(0, Math.floor(a / step)), i1 = Math.min(n - 1, Math.ceil(b / step)); for (let i = i0; i <= i1; i++) if (node[i] >= 0.5 && !(i > i0 && node[i - 1] >= 0.5)) k++; }
      return k;
    };
    const lights = (k) => (k === 0 ? 'no traffic lights' : k === 1 ? 'one set of lights' : `${k} sets of lights`);
    const leadBuilt = lead && lead.facts && lead.facts.share && (lead.facts.share.town + lead.facts.share.suburban >= T.MOSTLY) && lead.facts.known >= T.LEAD_KNOWN;
    if (leadBuilt) {                                                    // the lead already says it's town: the lights alone
      if (!sigKnown) return null;
      const k = lightsIn(0, total);
      return k >= 2 ? { kind: 'slow', text: `${cap(lights(k))} on the way.`, facts: { lights: k } } : null;
    }
    if (builtM >= T.SLOW_MIN_M || (builtM >= 400 && builtM >= T.SLOW_MIN_SHARE * total)) {
      const big = rs.filter((r) => r.toM - r.fromM >= 300);
      const at = new Set(big.map((r) => (r.fromM <= T.END_SHARE * total ? 'start' : r.toM >= (1 - T.END_SHARE) * total ? 'end' : 'middle')));
      // a run from end to end is the whole route: no "where"
      const where = at.size === 1 && at.has('start') ? ' at the start' : at.size === 1 && at.has('end') ? ' at the end' : at.size === 2 && at.has('start') && at.has('end') ? ' at both ends'
        : at.size === 1 && at.has('middle') ? ' in the middle' : at.size ? ' in places' : '';
      const k = sigKnown ? big.reduce((a, r) => a + lightsIn(r.fromM, r.toM), 0) : null;
      const through = townM >= subM ? 'through town' : 'through suburbs';
      const text = `About ${dist(builtM, metric)} ${through}${where}${k != null ? `, with ${lights(k)}` : ''}.`;
      return { kind: 'slow', text, facts: { builtM, townM, subM, where: [...at], lights: k } };
    }
    const side = ev && ev.poorBy && finite(ev.poorBy.residential) ? ev.poorBy.residential : 0;
    if (side >= T.SIDE_MIN_KM) return { kind: 'slow', text: `About ${dist(side * 1000, metric)} of side streets.`, facts: { sideKm: side } };
    return null;
  }

  function membersLine(S) {
    const { n, step, ch, names, distM } = S;
    const rough = ch('crowd_rough_g'), flow = ch('crowd_flow'), bank = ch('crowd_camber_deg'), loved = ch('loved');
    if (!rough && !flow && !bank && !loved) return null;
    const by = new Map();
    for (let i = 0; i < n; i++) {
      const has = [rough, flow, bank, loved].some((c) => c && finite(c[i]));
      if (!has) continue;
      const key = nameAt(names, distM[i]) || '';
      const x = by.get(key) || { name: key || null, m: 0, r: [], f: [], b: [], lovedM: 0 };
      x.m += step;
      if (rough && finite(rough[i])) x.r.push(rough[i]);
      if (flow && finite(flow[i])) x.f.push(flow[i]);
      if (bank && finite(bank[i])) x.b.push(bank[i]);
      if (loved && loved[i] >= 0.6) x.lovedM += step;
      by.set(key, x);
    }
    const said = [];
    for (const x of [...by.values()].filter((v) => v.m >= T.CROWD_MIN_M).sort((a, b) => b.m - a.m)) {
      const traits = [], minN = T.CROWD_MIN_M / step;
      const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
      if (x.r.length >= minN) { const r = mean(x.r); if (r < 0.1) traits.push('smooth'); else if (r > 0.22) traits.push('rough'); }
      if (x.f.length >= minN) { const f = mean(x.f); if (f >= 0.7) traits.push('flows well'); else if (f <= 0.35) traits.push('stop-start'); }
      if (x.b.length >= 0.6 * minN) { const b = quantile(x.b, 0.5); if (b >= 2) traits.push('well banked'); else if (b <= -1.5) traits.push('off-camber in places'); }
      if (x.lovedM >= 300) traits.push('one they come back to');
      if (traits.length) said.push({ name: x.name, m: x.m, traits });
      if (said.length === 2) break;
    }
    if (!said.length) return null;
    const phrase = (s) => {
      // "is smooth and flows well": the adjectives after "is", the verb as it reads
      const adj = s.traits.filter((t) => t !== 'flows well'), rest = s.traits.filter((t) => t === 'flows well');
      const parts = [...(adj.length ? [`is ${list(adj)}`] : []), ...rest];
      return `${s.name ? s.name : `the ${dist(s.m, S.metric)} they've measured`} ${list(parts)}`;
    };
    const text = `Members' drives say ${said.map(phrase).join('; ')}.`;
    return { kind: 'members', text, facts: { roads: said } };
  }

  // the engine's per-km and span costs (at the hour you'd be there) as a driver would say them; others are not said here
  const SAY = { deer: 'deer likely', fog: 'fog in places', 'cold road': 'cold roads', ice: 'ice possible', 'school zone': 'school zones in session',
    'school buses': 'school buses out', 'event traffic': 'event traffic', 'farm traffic': 'farm traffic', 'road works': 'road works', flooding: 'flooding',
    'flood-prone': 'flood-prone stretches after the rain', 'church traffic': 'church traffic', crosswind: 'strong crosswinds', cyclists: 'cyclists out',
    buggies: 'horse buggies', 'park crowds': 'park crowds', 'deer crossings': 'deer crossings' };
  const WX = { 3: 'rain likely', 4: 'storms', 5: 'snow', 6: 'ice possible' };
  function conditionsLine(S, o) {
    const { n, ch, ev } = S;
    const items = [];
    const add = (key, text, w) => { if (!items.some((x) => x.key === key || x.text === text)) items.push({ key, text, w }); };
    for (const h of (ev && ev.hard) || []) if (h.kind === 'closure') add('closure', 'a closure on the way', 100);
    // rain: the last 6 h known over enough of it, wet over enough of what is known
    const p6 = ch('precip_6h_mm');
    if (p6) {
      let k = 0, wet = 0;
      for (let i = 0; i < n; i++) if (finite(p6[i])) { k++; if (p6[i] >= 1) wet++; }
      if (k >= T.WET_KNOWN * n && wet >= T.WET_SHARE * k) add('wet', 'wet roads', 50);
    }
    const wx = ch('wx_hazard');
    if (wx) {
      const c = {};
      let k = 0;
      for (let i = 0; i < n; i++) if (finite(wx[i])) { k++; const v = Math.round(wx[i]); if (WX[v]) c[v] = (c[v] || 0) + 1; }
      for (const [v, m] of Object.entries(c)) if (k >= T.WET_KNOWN * n && m >= T.WET_SHARE * k) add(v === '6' ? 'ice' : `wx${v}`, WX[v], 40 + Number(v));
    }
    for (const p of (ev && ev.penalties) || []) {
      const text = SAY[p.label];
      if (!text || !(p.points >= T.PEN_MIN)) continue;
      add(p.label === 'ice' ? 'ice' : p.label, text, p.points);
    }
    if (finite(o.glareMin) && o.glareMin >= 3) add('glare', `low sun for ${Math.round(o.glareMin)} min`, 20);
    if (!items.length) return null;
    const pick = items.sort((a, b) => b.w - a.w).slice(0, 3);
    const light = ch('light');
    let dark = 0, lk = 0;
    if (light) for (let i = 0; i < n; i++) if (finite(light[i])) { lk++; if (light[i] === 0) dark++; }
    const night = lk >= T.WET_KNOWN * n && dark >= T.DARK_SHARE * lk;
    return { kind: 'conditions', text: `${cap(list(pick.map((x) => x.text)))}${night ? ' after dark' : ''}.`, facts: { items: pick, dark: lk ? dark / lk : null } };
  }

  /**
   * The overview of one ranked candidate { corridor, ctx, ev?, t? } (route_engine.js rank's output).
   * opts: { metric (bool), steps ([{ m, street }] on the track), track ({ events }; else the candidate's t), glareMin }.
   * { lines: [{ kind, text, facts }], coverage }. No lines when nothing is known well enough.
   */
  function build(ranked, opts = {}) {
    const E = Engine();
    const out = { lines: [], coverage: null };
    const c = ranked && ranked.corridor, ctx = ranked && ranked.ctx;
    if (!E || !c || !ctx || !c.distM || !c.distM.length) return out;
    const n = c.distM.length;
    if (n < 2) return out;
    const step = c.distM[1] - c.distM[0] || 25, total = c.totalM || c.distM[n - 1] + step;
    const ev = ranked.ev || null;
    const smp = (ev && ev.samples) || E.samples(c, ctx);
    const ch = (k) => E.channel(ctx, k);
    const set = settings(ctx, n);
    const rc = ch('road_class'), use = ch('road_use'), lanes = ch('lanes'), lim = ch('speed_limit_kph');
    const track = opts.track || ranked.t || {};
    const S = {
      n, step, total, distM: c.distM, ctx, ev, ch, set, metric: !!opts.metric, Q: smp.quality, events: track.events || [],
      names: namesAlong(opts.steps || track.steps, c.edges, total),
      limited: (i) => (rc && rc[i] === 0) || (use && use[i] === 1),
      kindWords(kind) {
        if (kind !== 'country') return { suburban: 'suburban roads', town: 'town streets', highway: 'highway' }[kind];
        // "two-lane" only where lanes are known over most of it; "lanes" where the roads are minor and slow
        let k = 0, two = 0, minor = 0, kc = 0, slow = 0, kl = 0;
        for (let i = 0; i < n; i++) {
          if (set[i] !== 'country') continue;
          kc++;
          if (lanes && finite(lanes[i])) { k++; if (lanes[i] <= 1) two++; }   // the channel is lanes in your direction: one each way
          if (rc && rc[i] >= 5) minor++;
          if (lim && finite(lim[i])) { kl++; if (lim[i] <= 56) slow++; }
        }
        if (minor >= 0.6 * kc && kl >= T.SPEED_KNOWN * kc && slow >= 0.6 * kl) return 'country lanes';
        return k >= 0.5 * kc && two >= 0.8 * k ? 'two-lane country roads' : 'country roads';
      },
      cover() {
        const forest = ch('forest_share'), canopy = ch('canopy_pct'), open = ch('open_country'), crop = ch('cropland_class'), water = ch('water_near'), creek = ch('creek_follow');
        const G = Grid(), group = G && G.cropGroup ? G.cropGroup : null;
        const kinds = { woods: [0, 0], farmland: [0, 0], water: [0, 0] };
        let kc = 0;
        for (let i = 0; i < n; i++) {
          if (set[i] !== 'country') continue;
          kc++;
          const f = forest && finite(forest[i]) ? forest[i] : canopy && finite(canopy[i]) ? canopy[i] / 100 : NaN;
          if (finite(f)) { kinds.woods[0]++; if (f >= 0.4) kinds.woods[1]++; }
          const g = crop && finite(crop[i]) && group ? group(crop[i]) : null;
          const fo = open && finite(open[i]) ? open[i] >= 0.5 : g ? ['crops', 'hay', 'pasture'].includes(g) : null;
          if (fo != null) { kinds.farmland[0]++; if (fo) kinds.farmland[1]++; }
          const w = water && finite(water[i]) ? water[i] : creek && finite(creek[i]) ? creek[i] : NaN;
          if (finite(w)) { kinds.water[0]++; if (w >= 0.5) kinds.water[1]++; }
        }
        const said = Object.entries(kinds).filter(([, [k, y]]) => kc && k >= T.COVER_KNOWN * kc && y >= T.COVER_SHARE * k).sort((a, b) => b[1][1] / b[1][0] - a[1][1] / a[1][0]).slice(0, 2).map(([k]) => k);
        const through = said.filter((k) => k !== 'water'), along = said.includes('water');
        const text = [through.length ? `through ${list(through)}` : '', along ? 'along the water' : ''].filter(Boolean).join(', ');
        return { said, text, of: kinds };
      },
    };
    const lead = leadLine(S, opts);
    const lines = [lead, highlightLine(S, opts), slowLine(S, opts, lead), membersLine(S), conditionsLine(S, opts)].filter(Boolean);
    let qk = 0, sk = 0;
    for (let i = 0; i < n; i++) { if (finite(S.Q[i])) qk++; if (set[i]) sk++; }
    out.lines = lines.slice(0, 5);
    out.coverage = { km: total / 1000, setting: sk / n, quality: qk / n, names: S.names.length ? S.names.reduce((a, x) => a + (x.name ? x.toM - x.fromM : 0), 0) / total : 0 };
    return out;
  }

  const api = { VERSION: 1, T, build, settings, namesAlong, namesIn, namesFor, dist, speed, roadNames };
  if (NODE) module.exports = api;
  root.ApexRouteStory = api;
})(typeof window !== 'undefined' ? window : globalThis);
