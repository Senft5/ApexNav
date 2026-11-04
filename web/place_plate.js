// The place plate on the idle map (docs/design/REVIEW.md 1.2, mockup 01-cockpit-idle.html): where you are and what the
// sky is doing, "Tellico Plains · Dry · 61°". Each part only when known (the town from the map's reverse geocode, the
// weather from the nearest National Weather Service station's latest observation and Open-Meteo's last 3 hours of rain);
// nothing at all when none is. Pure (tests/test_place_plate.py).
// Owner, 2026-11-04: "it's been raining all day and is currently raining and it says it's dry out". Open-Meteo's current
// weather_code was 3 (overcast) with 0.0 mm this quarter hour while its own past hours had 3.4, 0.2, 0.5 and 1.5 mm and
// the station reported light rain: a cloud code is not a road. "Dry" now needs the last 3 hours known and dry.
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

  // NWS presentWeather (METAR) words, as the plate's words; the first that matches wins
  const OBS = [[/thunder/, 'Storm'], [/snow|sleet|ice|hail|freezing/, 'Snow'], [/drizzle/, 'Drizzle'], [/rain|shower/, 'Rain'], [/fog|mist/, 'Fog']];
  const OBS_MAX_MIN = 90;
  /**
   * The weather in one word from everything known: { code, mmNow, mm3h, obs: { ageMin, weather: [strings] } }.
   * A fresh station observation of falling weather wins; then the forecast's code when it names weather; then rain this
   * quarter hour; then "Wet roads" after 0.2 mm or more in the last 3 hours; "Dry" only when that is known to be dry and
   * nothing says otherwise; else null (unknown stays unknown).
   */
  function weather(p) {
    if (!p) return null;
    const o = p.obs;
    if (o && finite(o.ageMin) && o.ageMin <= OBS_MAX_MIN && Array.isArray(o.weather)) {
      const said = o.weather.join(' ').toLowerCase();
      for (const [re, w] of OBS) if (re.test(said)) return w;
    }
    const w = sky(p.code);
    if (w && w !== 'Dry') return w;
    if (finite(p.mmNow) && p.mmNow > 0) return 'Rain';
    if (finite(p.mm3h) && p.mm3h >= 0.2) return 'Wet roads';
    return w === 'Dry' && finite(p.mm3h) ? 'Dry' : null;
  }
  /** Open-Meteo's hourly precipitation summed over the hours before now (past_hours=3), or null. */
  function pastMm(w, nowMs = Date.now()) {
    const h = w && w.hourly, t = h && h.time, mm = h && h.precipitation;
    if (!Array.isArray(t) || !Array.isArray(mm)) return null;
    let sum = 0, n = 0;
    for (let i = 0; i < t.length; i++) {
      const ms = Date.parse(t[i] + (/Z|[+-]\d\d:?\d\d$/.test(t[i]) ? '' : 'Z'));
      if (!(ms <= nowMs) || nowMs - ms > 3 * 3600e3 || !finite(mm[i])) continue;
      sum += mm[i]; n++;
    }
    return n ? sum : null;
  }
  /** An NWS observation (properties of /stations/X/observations/latest) as { ageMin, weather }, or null. */
  function obsOf(props, nowMs = Date.now()) {
    if (!props || !props.timestamp) return null;
    const ms = Date.parse(props.timestamp);
    if (!finite(ms)) return null;
    const weather = (Array.isArray(props.presentWeather) ? props.presentWeather : []).map((x) => [x && x.intensity, x && x.weather].filter(Boolean).join(' '));
    if (typeof props.textDescription === 'string' && props.textDescription) weather.push(props.textDescription);
    return { ageMin: (nowMs - ms) / 60000, weather };
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
    const w = weather(p);
    if (w) parts.push(w);
    if (p && finite(p.tempC)) parts.push(`${Math.round(metric ? p.tempC : p.tempC * 9 / 5 + 32)}°`);
    return parts.join(' · ');
  }

  const api = { sky, weather, pastMm, obsOf, town, text };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPlacePlate = api;
})(typeof window !== 'undefined' ? window : globalThis);
