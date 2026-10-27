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
  /** Drive names saved with a 24-hour time ("Drive 10/26/2026 17:03") read in 12-hour; any other name is unchanged. */
  function driveName(name) {
    const m = /^(Drive .+ )(\d{2}):(\d{2})$/.exec(name || '');
    return m ? m[1] + clock12(Number(m[2]), Number(m[3])) : name;
  }
  const api = { clock12, dateTime, driveName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexFormat = api;
})(typeof window !== 'undefined' ? window : globalThis);
