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
  /** Drive names saved with a 24-hour time ("Drive 10/26/2026 17:03") read in 12-hour; a recorder file name
   *  ("web_20261027_080000", how an exported drive comes back on import) reads like an app drive; any other name is unchanged. */
  function driveName(name) {
    const f = /^web_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})\d{2}$/.exec(name || '');
    if (f) return `Drive ${Number(f[2])}/${Number(f[3])}/${f[1]} ${clock12(Number(f[4]), Number(f[5]))}`;
    const m = /^(Drive .+ )(\d{2}):(\d{2})$/.exec(name || '');
    return m ? m[1] + clock12(Number(m[2]), Number(m[3])) : name;
  }
  // Dynamic Type: iOS sizes `-apple-system-body` from the phone's text size setting (17 px at the default, Large).
  // Reading pages (sheets, Log, Stages) zoom by that ratio. Never smaller than designed, and capped at 1.6 so the
  // largest accessibility sizes still fit a phone; the cockpit keeps its fixed at-a-glance sizes.
  /** 17 -> 1, 23 -> 1.35, 53 -> 1.6; smaller or unknown -> 1. Steps of 0.05. */
  function typeScale(bodyPx) {
    if (!(bodyPx > 0)) return 1;
    return Math.round(Math.max(1, Math.min(1.6, bodyPx / 17)) * 20) / 20;
  }
  /** Sets --type-scale on the page from the phone's text size; outside iOS WebKit it stays 1. */
  function applyTypeScale(doc) {
    let scale = 1;
    try {
      if (doc.defaultView.CSS && doc.defaultView.CSS.supports('font', '-apple-system-body')) {
        const probe = doc.createElement('span');
        probe.style.cssText = 'font: -apple-system-body; position: absolute; visibility: hidden';
        doc.body.appendChild(probe);
        scale = typeScale(parseFloat(doc.defaultView.getComputedStyle(probe).fontSize));
        probe.remove();
      }
    } catch (_) { scale = 1; }
    doc.documentElement.style.setProperty('--type-scale', String(scale));
    return scale;
  }
  /** Text people typed, with its emoji taken out (docs/design/REVIEW.md "Not doing": no emoji anywhere, chat included). */
  function noEmoji(s) {
    // Extended_Pictographic also holds the old text symbols (© ® ‼ ™ ...): only what sits at U+2190 and above goes
    return String(s == null ? '' : s).replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu, (c) => (c.codePointAt(0) < 0x2190 ? c : ''))
      .replace(/ {2,}/g, ' ').trim();
  }
  const api = { clock12, dateTime, driveName, typeScale, applyTypeScale, noEmoji };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFormat = api;
})(typeof window !== 'undefined' ? window : globalThis);
