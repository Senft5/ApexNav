// The place plate on the idle map (docs/design/REVIEW.md 1.2, mockup 01-cockpit-idle.html): where you are and what the
// sky is doing, "Tellico Plains · Dry · 61°". Each part only when known (the town from the map's reverse geocode, the
// weather from Open-Meteo's current conditions); nothing at all when none is. Pure (tests/test_place_plate.py).
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** A WMO weather code as one word a driver cares about, or null for a code it doesn't know. */
  function sky(code) {
    if (!finite(code)) return null;
    if (code <= 3) return 'Dry';
    if (code === 45 || code === 48) return 'Fog';
    if (code >= 51 && code <= 57) return 'Drizzle';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
    if (code >= 95 && code <= 99) return 'Storm';
    return null;
  }

  /** The town of a Nominatim reverse answer (zoom 10-14), or null. */
  function town(rev) {
    const a = rev && rev.address;
    if (!a) return null;
    const t = a.city || a.town || a.village || a.hamlet || a.municipality || a.county;
    return typeof t === 'string' && t.trim() ? t.trim().slice(0, 40) : null;
  }

  /** The plate's text, or '' when nothing is known. tempC in Celsius; metric picks the unit shown. */
  function text(p, metric) {
    const parts = [];
    if (p && typeof p.place === 'string' && p.place) parts.push(p.place);
    const w = p ? sky(p.code) : null;
    if (w) parts.push(w);
    if (p && finite(p.tempC)) parts.push(`${Math.round(metric ? p.tempC : p.tempC * 9 / 5 + 32)}°`);
    return parts.join(' · ');
  }

  const api = { sky, town, text };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPlacePlate = api;
})(typeof window !== 'undefined' ? window : globalThis);
