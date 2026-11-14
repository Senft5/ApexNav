// What a place's card says beyond its name (the map's place card, cockpit.js showPin; Apple and Google Maps show the
// same): whether it is open now and until when, its phone and its website, from the place's own OpenStreetMap tags
// (opening_hours, phone, website), asked of Overpass once the card is up. Unknown stays unknown: hours OSM doesn't
// have, or writes in a form read() doesn't follow (months, holidays only, sunrise...), say nothing rather than guess.
//
// Source: OpenStreetMap contributors, ODbL 1.0, via the Overpass API (as cameras.js and route_ctx/osm_overpass.js).
// Overpass sees the tapped place's name and position, nothing of the driver (docs/APP_REVIEW.md, third parties).
// read(), status() and contact() are pure (tests/test_place_info.py).
(function (root) {
  'use strict';
  const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];       // OSM's order: Monday first
  const DAY_WORD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY_MIN = 1440;

  /**
   * opening_hours as a week: week[d] is a list of [startMin, endMin] for weekday d (0 Monday); an end past 1440 runs
   * into the next day. Null for anything outside the common forms: "24/7"; rules "Mo-Fr 08:00-17:00; Sa 09:00-13:00";
   * day lists and ranges ("Mo,We-Fr", "Su-Tu"); several times ("11:00-14:00,17:00-22:00"); past midnight
   * ("18:00-02:00"); "off" / "closed"; no days (every day). A later rule replaces the days it names, as OSM reads it.
   * Holiday rules (PH, SH) are left out: a normal day is still read right.
   */
  function read(spec) {
    if (typeof spec !== 'string') return null;
    const s = spec.trim();
    if (!s) return null;
    const week = Array.from({ length: 7 }, () => []);
    if (s === '24/7') { week.forEach((w) => w.push([0, DAY_MIN])); return week; }
    let any = false;
    for (const raw of s.split(';')) {
      const rule = raw.trim();
      if (!rule) continue;
      if (/^(PH|SH)\b/.test(rule)) continue;                         // holidays: not today's reading
      const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?(?:,PH)?\s*(.*)$/.exec(rule);
      if (!m) return null;
      const days = m[1] ? dayList(m[1]) : [0, 1, 2, 3, 4, 5, 6];
      const rest = m[2].trim();
      let spans;
      if (/^(off|closed)$/i.test(rest)) spans = [];
      else if (rest === '24/7' || rest === '00:00-24:00') spans = [[0, DAY_MIN]];
      else {
        spans = [];
        for (const t of rest.split(',')) {
          const x = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(t.trim());
          if (!x) return null;
          const a = +x[1] * 60 + +x[2]; let b = +x[3] * 60 + +x[4];
          if (a >= DAY_MIN || b > 48 * 60 || +x[2] > 59 || +x[4] > 59) return null;
          if (b <= a) b += DAY_MIN;                                  // past midnight
          spans.push([a, b]);
        }
        if (!spans.length) return null;
      }
      for (const d of days) week[d] = spans.slice();
      any = true;
    }
    return any ? week : null;
  }
  function dayList(txt) {
    const out = new Set();
    for (const part of txt.split(',')) {
      const [a, b] = part.split('-').map((d) => DAYS.indexOf(d));
      if (b === undefined) out.add(a);
      else for (let d = a, n = 0; n < 7; d = (d + 1) % 7, n++) { out.add(d); if (d === b) break; }
    }
    return [...out];
  }

  const clock = (min) => {
    const m = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN, h = Math.floor(m / 60), mm = m % 60;
    if (m === 0) return 'midnight';
    if (m === 720) return 'noon';
    return `${h % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
  };

  /**
   * Open now? From week (read()) and a local Date: { open, text } where text is "Open 24 hours", "Open · until 9 PM",
   * "Closed · opens 7 AM", "Closed · opens tomorrow 7 AM", "Closed · opens Mon 9 AM", or "Closed" (no opening in a week).
   * Null without a week.
   */
  function status(week, now) {
    if (!week || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
    const today = (now.getDay() + 6) % 7, t = now.getHours() * 60 + now.getMinutes();
    // the next 8 days' spans on one line of minutes from today's midnight (yesterday's spill counts too)
    const spans = [];
    for (let k = -1; k <= 7; k++) for (const [a, b] of week[(today + k + 7) % 7]) spans.push([a + k * DAY_MIN, b + k * DAY_MIN]);
    spans.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const s of spans) { const l = merged[merged.length - 1]; if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else merged.push(s.slice()); }
    const cur = merged.find(([a, b]) => a <= t && t < b);
    if (cur) {
      if (cur[1] - t >= 7 * DAY_MIN) return { open: true, text: 'Open 24 hours' };
      // within a day the hour is enough ("until 2 AM" is tonight's); further off it names the day
      const day = cur[1] - t < DAY_MIN ? '' : `${DAY_WORD[(today + Math.floor(cur[1] / DAY_MIN)) % 7]} `;
      return { open: true, text: `Open · until ${day}${clock(cur[1])}` };
    }
    const next = merged.find(([a]) => a > t);
    if (!next) return { open: false, text: 'Closed' };
    const day = Math.floor(next[0] / DAY_MIN);
    const when = day === 0 ? '' : day === 1 ? 'tomorrow ' : `${DAY_WORD[(today + day) % 7]} `;
    return { open: false, text: `Closed · opens ${when}${clock(next[0])}` };
  }

  /** The tags a card shows: { hours: status() | null, phone: 'tel:' href and its text, web: an https URL and its host }. */
  function contact(tags, now) {
    const t = tags || {};
    const hours = status(read(t.opening_hours), now);
    const ph = String(t.phone || t['contact:phone'] || '').split(';')[0].trim();
    const phone = /^\+?[\d\s().-]{7,20}$/.test(ph) ? { href: `tel:${ph.replace(/[^\d+]/g, '')}`, text: ph } : null;
    let web = null;
    const w = String(t.website || t['contact:website'] || '').split(';')[0].trim();
    try {
      const u = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`);
      if (w && /^https?:$/.test(u.protocol) && u.hostname.includes('.')) web = { href: u.href, text: u.hostname.replace(/^www\./, '') };
    } catch (_) { web = null; }
    return { hours, phone, web };
  }

  /** The Overpass query for a place by its name within 60 m of where the map draws it. */
  function query(name, lat, lon) {
    const n = String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `[out:json][timeout:8];nwr(around:60,${(+lat).toFixed(6)},${(+lon).toFixed(6)})["name"="${n}"];out tags 1;`;
  }

  const kept = new Map();
  /** The place's OSM tags, or null (none found, no signal, every server slow). Kept for the session. */
  function lookup(name, lat, lon, fetchFn = root.fetch && root.fetch.bind(root)) {
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || !fetchFn || !root.ApexCameras) return Promise.resolve(null);
    const key = `${name}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
    if (!kept.has(key)) {
      kept.set(key, root.ApexCameras.fetchFirst(fetchFn, 'data=' + encodeURIComponent(query(name, lat, lon)), root.ApexCameras.SERVERS, 6000)
        .then((j) => { const e = j && Array.isArray(j.elements) ? j.elements.find((x) => x && x.tags) : null; if (!e) kept.delete(key); return e ? e.tags : null; })
        .catch(() => { kept.delete(key); return null; }));
    }
    return kept.get(key);
  }

  const api = { read, status, contact, query, lookup, clock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPlaceInfo = api;
})(typeof window !== 'undefined' ? window : globalThis);
