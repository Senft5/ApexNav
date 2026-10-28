// Seasonal and time-of-day closures (IDEAS R-22): OpenStreetMap's conditional access tags on the roads a planned route
// uses (`motor_vehicle:conditional=no @ (Nov 15-Apr 15)`, `access:conditional=no @ (19:00-07:00)`), checked for the time
// you'd get there. A mountain pass closed for winter or a gate shut at night is said on the route card. Map data, labelled
// as such; a rule it can't read is shown as written rather than guessed at. Pure (tests/test_conditional_closures.py).
(function (root) {
  'use strict';
  const KEYS = ['motor_vehicle:conditional', 'motorcar:conditional', 'vehicle:conditional', 'access:conditional'];
  const CLOSED = /^(no|private|destination\s*no)$/i;
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const DAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
  const mon = (s) => MONTHS.indexOf(String(s).slice(0, 3).toLowerCase());

  /** "no @ (Nov 15-Apr 15); yes @ (...)" → the closing rules: [{ cond }] with the condition text. */
  function closingRules(value) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of String(value || '')) {                       // ';' inside "(Mo-Fr 07:00-09:00; Sa 10:00-12:00)" is the rule's own
      if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    return parts.map((p) => p.trim()).map((p) => {
      const m = p.match(/^([^@]+?)\s*@\s*\(?(.+?)\)?$/);
      return m && CLOSED.test(m[1].trim()) ? { cond: m[2].trim() } : null;
    }).filter(Boolean);
  }

  // Date ranges: "Nov 15-Apr 15", "Nov-Apr", "Dec 1-Mar 31", "2026 Nov 01-2027 Apr 30" (years ignored: every year).
  function inDates(cond, d) {
    const m = cond.match(/^(?:\d{4}\s+)?([A-Za-z]{3})[a-z]*\s*(\d{1,2})?\s*-\s*(?:\d{4}\s+)?([A-Za-z]{3})[a-z]*\s*(\d{1,2})?$/);
    if (!m || mon(m[1]) < 0 || mon(m[3]) < 0) return undefined;
    const a = mon(m[1]) * 100 + (m[2] ? +m[2] : 1), b = mon(m[3]) * 100 + (m[4] ? +m[4] : 31), x = d.getMonth() * 100 + d.getDate();
    return a <= b ? x >= a && x <= b : x >= a || x <= b;
  }
  // Times, optionally after weekdays: "19:00-07:00", "Mo-Fr 07:00-09:00", "Sa,Su 10:00-18:00".
  function inTimes(cond, d) {
    const m = cond.match(/^(?:([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s+)?(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return undefined;
    if (m[1]) {
      const days = new Set();
      for (const part of m[1].toLowerCase().split(/\s*,\s*/)) {
        const [s, e] = part.split(/\s*-\s*/).map((x) => DAYS.indexOf(x));
        if (s < 0 || (e !== undefined && e < 0)) return undefined;
        if (e === undefined) days.add(s); else for (let k = s; ; k = (k + 1) % 7) { days.add(k); if (k === e) break; }
      }
      if (!days.has(d.getDay())) return false;
    }
    const a = +m[2] * 60 + +m[3], b = +m[4] * 60 + +m[5], x = d.getHours() * 60 + d.getMinutes();
    return a <= b ? x >= a && x < b : x >= a || x < b;
  }
  /** true closed, false open, undefined can't read it. */
  function closedAt(cond, d) {
    const parts = String(cond).split(';').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {                                       // "Mo-Fr 07:00-09:00; Sa 10:00-12:00": closed if any part is
      const st = parts.map((p) => closedAt(p, d));
      return st.some((s) => s === true) ? true : st.every((s) => s === false) ? false : undefined;
    }
    const a = inDates(cond, d);
    if (a !== undefined) return a;
    return inTimes(cond, d);
  }

  /**
   * ways: [{ name, tags, m }] (OSM ways on the route, `m` metres along it, `atMs` when you'd get there).
   * → [{ name, m, closed: true|false|null, rule }] for ways with a closing rule: closed now (true), open now but closed at
   * other times (false), or a rule it couldn't read (null). One per road name, nearest first.
   */
  function check(ways) {
    const out = [], seen = new Set();
    for (const w of (ways || []).slice().sort((x, y) => x.m - y.m)) {
      const rules = KEYS.flatMap((k) => closingRules(w.tags && w.tags[k]));
      if (!rules.length) continue;
      const name = (w.tags && (w.tags.name || w.tags.ref)) || 'A road on the route';
      if (seen.has(name)) continue;
      seen.add(name);
      const d = new Date(w.atMs);
      const states = rules.map((r) => closedAt(r.cond, d));
      const closed = states.some((s) => s === true) ? true : states.every((s) => s === false) ? false : null;
      out.push({ name, m: w.m, closed, rule: rules.map((r) => r.cond).join('; ') });
    }
    return out;
  }

  /** One line for the route card, or ''. */
  function summary(list) {
    const shut = list.filter((x) => x.closed === true), unsure = list.filter((x) => x.closed === null), later = list.filter((x) => x.closed === false);
    const parts = [];
    if (shut.length) parts.push(`Closed when you'd get there (map data): ${shut.map((x) => `${x.name} (${x.rule})`).join(', ')}`);
    if (unsure.length) parts.push(`Has access rules: ${unsure.map((x) => `${x.name} (${x.rule})`).join(', ')}`);
    if (later.length && !shut.length) parts.push(`Open now; closed at times: ${later.map((x) => `${x.name} (${x.rule})`).join(', ')}`);
    return parts.join(' · ');
  }

  const query = (s, w, n, e) => `[out:json][timeout:25];(${KEYS.map((k) => `way["highway"]["${k}"](${[s, w, n, e].map((v) => v.toFixed(4)).join(',')});`).join('')});out tags center;`;

  const api = { closingRules, closedAt, check, summary, query, KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexConditional = api;
})(typeof window !== 'undefined' ? window : globalThis);
