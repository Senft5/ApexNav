// Your roads and a Sunday suggestion (panel round 1, D-1 and R-1). The idle deck learns what you drive: up to three of your
// own roads, each a tap from being driven again, and the row above them names one real suggestion with its reason, in this
// order: a crew drive you said you're going to within a week; this week's time attack loop, when you entered it; the best
// road near you that you haven't driven (with the sky now, when the plate knows it); the week's loop you haven't entered;
// the road you scored best on; else the loop from here, as before. And one reminder, opt-in
// (Garage > Reminder), at most once a week, the evening before your usual day, naming that suggestion. No streaks, no counts
// of days away (REVIEW.md "Not doing"). Unknown stays unknown: a drive that no road named is not a road, a road never scored
// has no best, and with no usual day there is no reminder. Pure (tests/test_your_roads.py); cockpit.js draws and asks.
(function (root) {
  'use strict';
  const MIN_LEN_M = 1000;                 // shorter than this, a drive is an errand, not a road to drive again
  const WEEK_MS = 7 * 86400000, NUDGE_GAP_MS = 6 * 86400000, EVENING_H = 19;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const keyOf = (s) => String(s).trim().toLowerCase();

  /** Is a drive's name a road's? Not the date name a drive gets when no road carried it ("Drive 11/2/2026 7:38 PM", the raw
   *  "web_20261102_193800"), a loop ("45 mi loop"), a trip to a place ("To Shell", "Home") or a dropped pin. */
  function isRoadName(name) {
    if (typeof name !== 'string') return false;
    const n = name.trim();
    if (n.length < 2 || n.length > 80) return false;
    return !/^(drive\b|web_\d|to\s|pin\s|home$|the road ahead$)/i.test(n) && !/\bloop$/i.test(n);
  }

  /**
   * Your roads from the Log's summaries: one per road name, the most recently driven first. Each:
   * { name, id (the latest drive on it), runs, best (the best whole Vetta Score, or null when none was scored), lenM, at }.
   * Only drives recorded or imported by you, named after a road, at least MIN_LEN_M long.
   */
  function roads(summaries, max = 3) {
    const by = new Map();
    for (const s of Array.isArray(summaries) ? summaries : []) {
      if (!s || (s.source !== 'web-gps' && s.source !== 'imported') || !isRoadName(s.name) || !(finite(s.len_m) && s.len_m >= MIN_LEN_M)) continue;
      const k = keyOf(s.name), at = Date.parse(s.date) || 0, sc = s.ds && finite(s.ds.score) ? Math.round(s.ds.score) : null;
      const r = by.get(k) || { name: s.name.trim(), id: s.id, runs: 0, best: null, lenM: s.len_m, at: -1 };
      r.runs += 1;
      if (sc != null && (r.best == null || sc > r.best)) r.best = sc;
      if (at > r.at) Object.assign(r, { name: s.name.trim(), id: s.id, lenM: s.len_m, at });
      by.set(k, r);
    }
    return [...by.values()].sort((a, b) => b.at - a.at).slice(0, max);
  }

  /** "14 mi · best 788 · 4 runs": each part only when known. long(m) formats a length in the user's units. */
  function roadLine(r, long) {
    return [finite(r.lenM) ? long(r.lenM) : null, r.best != null ? `best ${r.best}` : null, `${r.runs} ${r.runs === 1 ? 'run' : 'runs'}`].filter(Boolean).join(' · ');
  }

  /** Is this road one of yours (driven under the same name)? */
  const driven = (name, mine) => !!name && (mine || []).some((r) => keyOf(r.name) === keyOf(name));

  const nth = (n) => { const t = n % 100, u = n % 10; return `${n}${t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'}`; };

  /**
   * This week's time attack loop for the deck, from GET /api/timeattack's answer (backend/src/time_attack.ts), or null: no
   * loop in the area yet, the week over, or no start to drive to. { key, name, entered, place (yours, null with no time),
   * times (on the board), left (days, today included), until (ms, the week's end), lenM, lat, lon (the start), geom }.
   */
  function attackFrom(t) {
    const c = t && t.circuit;
    if (!c || typeof c.name !== 'string' || !c.name.trim()) return null;
    let g = [];
    try { g = (typeof c.geom === 'string' ? JSON.parse(c.geom) : c.geom) || []; } catch (_) { g = []; }
    g = Array.isArray(g) ? g.filter((p) => Array.isArray(p) && finite(p[0]) && finite(p[1])) : [];
    if (g.length < 2) return null;
    const a = Date.parse(`${t.today}T00:00:00Z`), b = Date.parse(`${t.ends_on}T00:00:00Z`);
    const left = finite(a) && finite(b) ? Math.max(0, Math.round((b - a) / 86400000) + 1) : null;
    if (left === 0) return null;
    return { key: `${t.week}|${t.cell}|${c.segment_id}`, name: c.name.trim(), entered: !!t.entered,
             place: t.you && finite(t.you.place) ? t.you.place : null, times: finite(t.entrants) ? t.entrants : 0, left,
             until: finite(b) ? b + 86400000 : null, lenM: finite(c.length_m) ? c.length_m : null, lat: g[0][0], lon: g[0][1], geom: g };
  }

  /**
   * The one suggestion, or null for the loop. Inputs, each optional:
   *   crew:    { title, crew, when ("Sun 9:00 AM"), at (ms), lat, lon } a crew drive you're going to
   *   attack:  attackFrom() this week's time attack loop; entered, it comes right after a crew drive, else after the untried road
   *   untried: { name, good, awayM, sky } the best road near you, named; awayM is straight-line (nothing is routed unasked)
   *   mine:    roads() (all of them, not just the three shown)
   * Returns { kind: 'crew' | 'attack' | 'untried' | 'best', title, reason, name, ... } with every word from what was measured or said.
   */
  function suggest({ crew = null, attack = null, untried = null, mine = [], now = Date.now(), long = (m) => `${(m / 1609.344).toFixed(0)} mi` } = {}) {
    if (crew && finite(crew.at) && crew.at > now - 3600000 && crew.at - now <= WEEK_MS && crew.title) {
      return { kind: 'crew', name: crew.title, when: crew.when || null, title: [crew.when, crew.title].filter(Boolean).join(' · '),
               reason: [crew.crew, 'you’re going'].filter(Boolean).join(' · '), at: crew.at, lat: crew.lat, lon: crew.lon };
    }
    const ta = attack && attack.name && finite(attack.lat) && finite(attack.lon) && !(finite(attack.until) && attack.until <= now) ? attack : null;
    const attackSugg = () => {
      const left = finite(ta.left) ? (ta.left === 1 ? 'last day' : `${ta.left} days left`) : null;
      const how = ta.entered
        ? (ta.place != null ? `You’re ${nth(ta.place)} of ${ta.times}` : 'No time yet')
        : ['This week’s loop', finite(ta.lenM) ? long(ta.lenM) : null, ta.times > 0 ? `${ta.times} ${ta.times === 1 ? 'time' : 'times'}` : null].filter(Boolean).join(' · ');
      // the place and the days left are today's: the reminder says only what lasts
      return { kind: 'attack', name: ta.name, key: ta.key, entered: ta.entered, title: `Time attack · ${ta.name}`, reason: [how, left].filter(Boolean).join(' · '),
               lasting: ['This week’s time attack', finite(ta.lenM) ? long(ta.lenM) : null].filter(Boolean).join(' · '),
               lat: ta.lat, lon: ta.lon, until: ta.until };
    };
    if (ta && ta.entered) return attackSugg();
    if (untried && untried.name && !driven(untried.name, mine) && finite(untried.awayM)) {
      const lasting = ['Not driven yet', `${long(untried.awayM)} from here`,
        finite(untried.good) && untried.good > 0 ? `${untried.good} good ${untried.good === 1 ? 'corner' : 'corners'}` : null].filter(Boolean).join(' · ');
      // the sky is now's, at your position (the place plate's): said on the map, never in tomorrow's reminder
      return { kind: 'untried', name: untried.name, title: untried.name, reason: [lasting, untried.sky ? `${untried.sky} now` : null].filter(Boolean).join(' · '), lasting };
    }
    if (ta) return attackSugg();
    const best = (mine || []).filter((r) => r.best != null).sort((a, b) => b.best - a.best || b.at - a.at)[0];
    if (best) {
      return { kind: 'best', name: best.name, id: best.id, title: `Back to ${best.name}`,
               reason: [`Your best Score here, ${best.best}`, finite(best.lenM) ? long(best.lenM) : null].filter(Boolean).join(' · ') };
    }
    return null;
  }

  /** The deck's rows under the search: the suggestion (or the loop), then your roads not already named, three rows at most;
   *  the loop comes back as the last row when there is room. [{ kind: 'suggest' | 'road' | 'loop', … }] */
  function deck(sugg, mine, max = 3) {
    const rows = [sugg ? { kind: 'suggest', s: sugg } : { kind: 'loop' }];
    for (const r of mine || []) {
      if (rows.length >= max) break;
      if (sugg && sugg.name && keyOf(sugg.name) === keyOf(r.name)) continue;
      rows.push({ kind: 'road', r });
    }
    if (sugg && rows.length < max) rows.push({ kind: 'loop' });
    return rows;
  }

  /** The weekday you drive on most (0 = Sunday), from your drives' dates; null until one day has two drives and leads. */
  function usualDay(dates) {
    const n = new Array(7).fill(0);
    for (const d of dates || []) { const t = new Date(d); if (Number.isFinite(t.getTime())) n[t.getDay()] += 1; }
    const top = Math.max(...n), day = n.indexOf(top);
    return top >= 2 && n.filter((v) => v === top).length === 1 ? day : null;
  }

  /** 7 PM the evening before the next `day` (0-6) after now, local time. */
  function eveningBefore(day, now) {
    const t = new Date(now);
    for (let k = 0; k <= 8; k++) {
      const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + k, EVENING_H);
      if ((d.getDay() + 1) % 7 === day && d.getTime() > now) return d.getTime();
    }
    return null;
  }

  /**
   * When the reminder goes, or null: the evening before your crew drive (when the suggestion is one), else the evening
   * before your usual day; never within NUDGE_GAP_MS of the last one (at most once a week), never in the past.
   */
  function nudgeAt({ now = Date.now(), day = null, crewAt = null, lastAt = null } = {}) {
    const floor = finite(lastAt) ? lastAt + NUDGE_GAP_MS : -Infinity;
    if (finite(crewAt)) {
      const c = new Date(crewAt), e = new Date(c.getFullYear(), c.getMonth(), c.getDate() - 1, EVENING_H).getTime();
      if (e > now && e >= floor) return e;
    }
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    for (let at = eveningBefore(day, now); at != null && at - now <= 3 * WEEK_MS; at = eveningBefore(day, at + 3600000)) if (at >= floor) return at;
    return null;
  }

  /** The reminder's words: it names the suggestion and the day, and asks nothing of you. `at`, when given, is when it goes:
   *  a time attack week that is over by the next day is not named. */
  function nudgeText(sugg, day, at) {
    const when = Number.isInteger(day) ? `${DAYS[day]}` : 'Tomorrow';
    if (sugg && sugg.kind === 'attack' && finite(at) && finite(sugg.until) && at + 12 * 3600000 >= sugg.until) sugg = null;
    if (sugg && sugg.kind === 'crew') return { title: `Tomorrow: ${sugg.name}`, body: [sugg.when || null, sugg.reason].filter(Boolean).join(' · ') };
    if (sugg) return { title: `${when}: ${sugg.name}`, body: sugg.lasting || sugg.reason };
    return { title: `${when}: a loop from home`, body: 'On the twistiest roads nearby, when you want it.' };
  }

  /** Shaping points for Drive it again: from here to the drive's start, through up to `mids` points along it, to its end. */
  function againPoints(from, lat, lon, mids = 7) {
    const n = Math.min((lat || []).length, (lon || []).length);
    if (n < 2) return null;
    const pts = [];
    if (from && finite(from.lat) && finite(from.lon)) pts.push({ lat: from.lat, lon: from.lon });
    for (let k = 0; k <= mids + 1; k++) {
      const i = Math.round((k / (mids + 1)) * (n - 1));
      if (finite(lat[i]) && finite(lon[i])) pts.push({ lat: lat[i], lon: lon[i], shaping: k > 0 && k <= mids });
    }
    return pts.length >= 2 ? pts : null;
  }

  const api = { isRoadName, roads, roadLine, attackFrom, suggest, deck, usualDay, eveningBefore, nudgeAt, nudgeText, againPoints, MIN_LEN_M, NUDGE_GAP_MS, DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexYourRoads = api;
})(typeof window !== 'undefined' ? window : globalThis);
