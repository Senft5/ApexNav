// Display formatting shared by the cockpit and the analysis page. Times are 12-hour (owner 2026-10-26).
(function (root) {
  /** 17, 3 -> "5:03 PM"; 0, 5 -> "12:05 AM". */
  function clock12(h, m) {
    if (!Number.isInteger(h) || !Number.isInteger(m)) return '--';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  /** Local ISO "2026-10-26T17:03" -> "2026-10-26 5:03 PM"; a date alone stays a date; nothing -> "--". */
  function dateTime(iso) {
    if (!iso) return '--';
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
    if (!m) return '--';
    return m[2] === undefined ? m[1] : `${m[1]} ${clock12(Number(m[2]), Number(m[3]))}`;
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
    return String(s == null ? '' : s).replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu, '').replace(/ {2,}/g, ' ').trim();
  }
  const api = { clock12, dateTime, driveName, typeScale, applyTypeScale, noEmoji };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFormat = api;
})(typeof window !== 'undefined' ? window : globalThis);
