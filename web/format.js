// Display formatting shared by the cockpit and the analysis page. Times are 12-hour (owner 2026-10-26).
(function (root) {
  /** 17, 3 -> "5:03 PM"; 0, 5 -> "12:05 AM". */
  function clock12(h, m) {
    if (!Number.isInteger(h) || !Number.isInteger(m)) return '--';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  /**
   * A date said, not set like a database field (REVIEW5 U-126): "Today, 8:02 AM", "Yesterday, 6:40 PM", then the day in
   * the phone's own format ("Nov 1, 8:02 AM" / "1 Nov, 8:02 AM"), with the year only when it is not this one. A local ISO
   * ("2026-10-26T17:03") is that wall time; one with a zone ("…Z") is shown in the phone's. A date alone stays a day;
   * nothing -> "--". `now` and `locale` are for tests.
   */
  function dateTime(iso, now, locale) {
    if (!iso || typeof iso !== 'string') return '--';
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
    if (!m) return '--';
    const zoned = m[4] !== undefined && /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);
    const d = zoned ? new Date(iso) : new Date(+m[1], +m[2] - 1, +m[3], m[4] === undefined ? 0 : +m[4], m[5] === undefined ? 0 : +m[5]);
    if (Number.isNaN(d.getTime())) return '--';
    const at = now instanceof Date ? now : new Date();
    const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const ago = Math.round((day0(at) - day0(d)) / 864e5);
    let day;
    if (ago === 0) day = 'Today';
    else if (ago === 1) day = 'Yesterday';
    else {
      const opts = { day: 'numeric', month: 'short', ...(d.getFullYear() !== at.getFullYear() ? { year: 'numeric' } : {}) };
      try { day = d.toLocaleDateString(typeof locale === 'string' ? locale : undefined, opts); } catch (_) { day = `${m[1]}-${m[2]}-${m[3]}`; }
    }
    return m[4] === undefined ? day : `${day}, ${clock12(d.getHours(), d.getMinutes())}`;
  }
  /** A day for a chart's axis: "30 Oct" in the phone's own order ("Oct 30"), never "10-30"; '' when it isn't a date. */
  function dayShort(iso, locale) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof iso === 'string' ? iso : '');
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (Number.isNaN(d.getTime()) || d.getMonth() !== +m[2] - 1) return '';
    try { return d.toLocaleDateString(typeof locale === 'string' ? locale : undefined, { day: 'numeric', month: 'short' }); } catch (_) { return `${m[2]}-${m[3]}`; }
  }
  /** Drive names saved with a 24-hour time ("Drive 10/26/2026 17:03") read in 12-hour; a recorder file name
   *  ("web_20261027_080000", how an exported drive comes back on import) reads like an app drive; any other name is unchanged. */
  function driveName(name) {
    const f = /^web_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})\d{2}$/.exec(name || '');
    if (f) return `Drive ${Number(f[2])}/${Number(f[3])}/${f[1]} ${clock12(Number(f[4]), Number(f[5]))}`;
    const m = /^(Drive .+ )(\d{2}):(\d{2})$/.exec(name || '');
    return m ? m[1] + clock12(Number(m[2]), Number(m[3])) : name;
  }
  // Dynamic Type: iOS sizes `-apple-system-body` from the phone's text size setting (17 px at the default, Large).
  // Reading pages (sheets, the Log, Stages, and since panel round 2 IN-1 the plan sheet, the route card, the drive's page
  // in the Log and the end card) zoom by that ratio. Never smaller than designed; capped at 2.0 (WCAG 1.4.4's 200 %) where
  // the page scrolls, and at 1.6 (`--type-scale-fit`) where it must fit one screen (the end card's keys). The cockpit keeps
  // its fixed at-a-glance sizes.
  /** 17 -> 1, 23 -> 1.35, 34 -> 2, 53 -> 2; smaller or unknown -> 1. Steps of 0.05. `max` is the cap. */
  function typeScale(bodyPx, max = 2) {
    if (!(bodyPx > 0)) return 1;
    return Math.round(Math.max(1, Math.min(max, bodyPx / 17)) * 20) / 20;
  }
  /** What the page gets for a text size: the two scales, and `size` for layouts that change shape ('large' from 1.4: the
   *  route card's stats and dials go two a row; 'up' above 1: truncated rows wrap instead; '' at 1). */
  function typeScales(bodyPx) {
    const scale = typeScale(bodyPx), fit = typeScale(bodyPx, 1.6);
    return { scale, fit, size: scale >= 1.4 ? 'large' : scale > 1 ? 'up' : '' };
  }
  /** Sets --type-scale, --type-scale-fit and html[data-type-size] from the phone's text size; outside iOS WebKit they stay 1. */
  function applyTypeScale(doc) {
    let px = 0;
    try {
      if (doc.defaultView.CSS && doc.defaultView.CSS.supports('font', '-apple-system-body')) {
        const probe = doc.createElement('span');
        probe.style.cssText = 'font: -apple-system-body; position: absolute; visibility: hidden';
        doc.body.appendChild(probe);
        px = parseFloat(doc.defaultView.getComputedStyle(probe).fontSize);
        probe.remove();
      }
    } catch (_) { px = 0; }
    const t = typeScales(px), root = doc.documentElement;
    root.style.setProperty('--type-scale', String(t.scale));
    root.style.setProperty('--type-scale-fit', String(t.fit));
    if (t.size) root.setAttribute('data-type-size', t.size); else root.removeAttribute('data-type-size');
    return t.scale;
  }
  /** Text people typed, with its emoji taken out (docs/design/REVIEW.md "Not doing": no emoji anywhere, chat included). */
  function noEmoji(s) {
    // Extended_Pictographic also holds the old text symbols (© ® ‼ ™ ...): only what sits at U+2190 and above goes
    return String(s == null ? '' : s).replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu, (c) => (c.codePointAt(0) < 0x2190 ? c : ''))
      .replace(/ {2,}/g, ' ').trim();
  }
  // ---- a drive's facts: one set of numbers everywhere (panel round 2, RA-3) -------------------------------------------
  // The end card, the drive page, the Log row, Your week, the year line, the share card and the deck all read a drive's
  // distance, time and corners through these, so one drive never shows two numbers (recording 7: the end card said
  // 3 corners and the Log row 2; the year said 1 mi over a week of 1.3 mi). web/vocabulary.js defines the words.
  const MI = 1609.344;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  /** A distance: one decimal under 10 ("1.3 mi"), whole from 10 ("71 mi"), in the chosen units; "--" when unknown. */
  function distance(m) {
    if (!finite(m)) return '--';
    const U = root.ApexUnits;
    if (U) return U.long(m, 1, true);
    const v = m / MI;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1)} mi`;
  }
  /** A drive's time in minutes ("2 min", "1 h 5 min"); null when unknown. */
  function minutes(secs) {
    if (!finite(secs) || secs < 0) return null;
    const m = Math.round(secs / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  }
  /** "3 corners", "1 corner", "0 corners"; null when unknown. */
  const cornerCount = (n) => (finite(n) && n >= 0 ? `${n} corner${n === 1 ? '' : 's'}` : null);
  /**
   * A drive's facts from whichever shape the app holds it in: a Log drive (dist[] or km, corners[]), a summary (len_m,
   * secs, corners[]), the end card's (len_m, secs, corners as a count). Corners are every corner the drive found for its
   * car (recording.js cornersOf), never only the clean ones the Score counted (ds.corners). Unknown stays null.
   */
  function driveFacts(d) {
    if (!d) return { len_m: null, secs: null, corners: null };
    const len = finite(d.len_m) ? d.len_m : Array.isArray(d.dist) && d.dist.length && finite(d.dist[d.dist.length - 1]) ? d.dist[d.dist.length - 1]
      : finite(d.km) ? d.km * 1000 : null;
    const secs = finite(d.secs) ? d.secs : finite(d.duration_s) ? d.duration_s : null;
    const corners = Array.isArray(d.corners) ? d.corners.length : finite(d.corners) ? d.corners : null;
    return { len_m: len, secs, corners };
  }
  /** "1.3 mi · 2 min · 3 corners": the parts asked for ('distance', 'time', 'corners'), each only when known. */
  function factsLine(d, parts = ['distance', 'time', 'corners']) {
    const f = driveFacts(d);
    const out = { distance: finite(f.len_m) ? distance(f.len_m) : null, time: minutes(f.secs), corners: cornerCount(f.corners) };
    return parts.map((p) => out[p]).filter(Boolean).join(' · ');
  }
  const api = { clock12, dateTime, dayShort, driveName, typeScale, typeScales, applyTypeScale, noEmoji, distance, minutes, cornerCount, driveFacts, factsLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFormat = api;
})(typeof window !== 'undefined' ? window : globalThis);
