// Weather along the route (IDEAS R-21): the forecast at a few points along a planned route, each for the hour you'd get
// there if you left now (the router's own times), from Open-Meteo (free, no key). It names what changes the drive (rain,
// ice, snow, fog, heat) and where; "no rain, ice or fog forecast" when that is what it says; nothing when the forecast
// couldn't be had. A forecast, labelled as one. Pure (tests/test_route_weather.py); the page fetches.
(function (root) {
  'use strict';
  const POINTS = 6, FALLBACK_MPS = 50 / 3.6;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const SNOW = new Set([71, 73, 75, 77, 85, 86]), FREEZING = new Set([56, 57, 66, 67]), FOG = new Set([45, 48]), STORM = new Set([95, 96, 99]);

  /** Where to ask: [{ m, lat, lon, atMs }] evenly along `t` (start and end included), timed by `secAt(m)` from `leaveMs`. */
  function samplePoints(t, leaveMs, secAt) {
    const n = t && Array.isArray(t.dist) ? t.dist.length : 0;
    if (n < 2) return [];
    const total = t.dist[n - 1], out = [];
    for (let k = 0; k < POINTS; k++) {
      const m = total * k / (POINTS - 1);
      let i = 0;
      while (i < n - 1 && t.dist[i] < m) i++;
      const s = secAt ? secAt(t.dist[i]) : null;
      out.push({ m: t.dist[i], lat: t.lat[i], lon: t.lon[i], atMs: leaveMs + 1000 * (finite(s) ? s : t.dist[i] / FALLBACK_MPS) });
    }
    return out;
  }

  const URL_BASE = 'https://api.open-meteo.com/v1/forecast';
  /** One request for all points (Open-Meteo takes comma-separated coordinates). */
  const url = (pts) => `${URL_BASE}?latitude=${pts.map((p) => p.lat.toFixed(3)).join(',')}&longitude=${pts.map((p) => p.lon.toFixed(3)).join(',')}`
    + '&hourly=precipitation_probability,precipitation,temperature_2m,visibility,weather_code&forecast_days=3&timezone=GMT&timeformat=unixtime';

  /** The hour nearest each point's arrival: [{ m, atMs, prob, mm, tempC, visM, code }]; null fields where the forecast has none. */
  function atArrival(json, pts) {
    const list = Array.isArray(json) ? json : json ? [json] : [];
    return pts.map((p, k) => {
      const h = list[k] && list[k].hourly;
      if (!h || !Array.isArray(h.time) || !h.time.length) return { m: p.m, atMs: p.atMs, prob: null, mm: null, tempC: null, visM: null, code: null };
      let best = 0;
      for (let i = 1; i < h.time.length; i++) if (Math.abs(h.time[i] * 1000 - p.atMs) < Math.abs(h.time[best] * 1000 - p.atMs)) best = i;
      const far = Math.abs(h.time[best] * 1000 - p.atMs) > 2 * 3600e3;          // beyond the forecast: unknown
      const v = (a) => (!far && Array.isArray(a) && finite(a[best]) ? a[best] : null);
      return { m: p.m, atMs: p.atMs, prob: v(h.precipitation_probability), mm: v(h.precipitation), tempC: v(h.temperature_2m), visM: v(h.visibility), code: v(h.weather_code) };
    });
  }

  /** What matters at one point: 'ice' | 'snow' | 'storm' | 'rain' | 'fog' | 'heat' | null (fine) | undefined (unknown). */
  function hazard(w) {
    if (!w || [w.prob, w.mm, w.tempC, w.code].every((x) => x == null)) return undefined;
    const wet = (w.mm != null && w.mm >= 0.3) || (w.prob != null && w.prob >= 60);
    if (FREEZING.has(w.code) || (w.tempC != null && w.tempC <= 1 && wet)) return 'ice';
    if (SNOW.has(w.code)) return 'snow';
    if (STORM.has(w.code)) return 'storm';
    if (wet) return 'rain';
    if (FOG.has(w.code) || (w.visM != null && w.visM < 1000)) return 'fog';
    if (w.tempC != null && w.tempC >= 35) return 'heat';
    return null;
  }
  const WORDS = { ice: 'Ice risk', snow: 'Snow', storm: 'Thunderstorms', rain: 'Rain likely', fog: 'Fog', heat: 'Very hot' };
  const ORDER = ['ice', 'snow', 'storm', 'rain', 'fog', 'heat'];

  /**
   * One line for the route card. `fmt.dist(m)` and `fmt.time(ms)` format for the page. '' when nothing is known.
   * Each kind is named once, at its first point: "Rain likely from 23 mi (about 3 PM) · Fog near 40 mi".
   */
  function summary(list, fmt) {
    const known = (list || []).map((w) => ({ w, h: hazard(w) })).filter((x) => x.h !== undefined);
    if (!known.length) return '';
    const seen = new Map();
    for (const { w, h } of known) if (h && !seen.has(h)) seen.set(h, w);
    if (!seen.size) return 'Forecast along the way: no rain, ice or fog';
    return 'Forecast: ' + ORDER.filter((h) => seen.has(h)).map((h) => {
      const w = seen.get(h);
      return `${WORDS[h]} ${w.m < 1 ? 'at the start' : `near ${fmt.dist(w.m)}`} (about ${fmt.time(w.atMs)})`;
    }).join(' · ');
  }

  /**
   * What the weather costs a candidate route in the ranking (fun points, IDEAS R-21): the share of its sampled points with
   * ice or snow (30), storms (15), rain (6) or fog (4). Unknown points cost nothing; heat costs nothing (it isn't grip).
   */
  const COST = { ice: 30, snow: 30, storm: 15, rain: 6, fog: 4 };
  function cost(list) {
    const known = (list || []).map(hazard).filter((h) => h !== undefined);
    if (!known.length) return 0;
    return Math.round(10 * known.reduce((s, h) => s + (COST[h] || 0), 0) / known.length) / 10;
  }

  const api = { samplePoints, url, atArrival, hazard, summary, cost, COST, POINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexRouteWeather = api;
})(typeof window !== 'undefined' ? window : globalThis);
