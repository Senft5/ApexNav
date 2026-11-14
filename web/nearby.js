// Find nearby (2026-11-13, against Apple Maps' and Google Maps' "Gas", "Coffee", "Food" keys): the places of one kind
// near you, from the map's own tiles (stages.js poisAll, the 'poi' layer at z14), so it works with the tiles you have and
// needs no search service. Pure: what each kind is, which spots to read tiles at, and the list nearest first.
(function (root) {
  'use strict';

  // a kind: its key's words, which tile places it takes (OpenMapTiles poi class / subclass), the stamp on the map; the
  // nouns are the route's Along list's (scenic.js KIND_NAME), so a place is called the same in both
  const CATS = {
    gas: { label: 'Gas', noun: 'Fuel station', stamp: 'FUEL', match: (p) => p.cls === 'fuel' && p.sub !== 'charging_station' },
    charge: { label: 'Chargers', noun: 'EV charger', stamp: 'CHARGE', match: (p) => p.cls === 'fuel' && p.sub === 'charging_station' },
    coffee: { label: 'Coffee', noun: 'Café', stamp: 'CAFÉ', match: (p) => p.cls === 'cafe' },
    food: { label: 'Food', noun: 'Restaurant', stamp: 'FOOD', match: (p) => p.cls === 'restaurant' || p.cls === 'fast_food' },
    // where to leave the car when you get there (Apple Maps' Parking key): lots and garages, never bike stands
    parking: { label: 'Parking', noun: 'Parking', unnamed: 'Parking lot', stamp: 'PARK', match: (p) => p.cls === 'parking' },
  };

  /** The keys Where to? shows, in order: an electric car's "Gas" is its chargers. */
  function keys(electric) { return [electric ? 'charge' : 'gas', 'coffee', 'food', 'parking']; }

  // what's typed that means a kind ("gas", "gas station", "coffee near me", "food")
  const WORDS = [
    [/^(gas|gas station|gas stations|fuel|petrol|petrol station)$/, 'gas'],
    [/^(charger|chargers|charging|charging station|ev charger|ev chargers)$/, 'charge'],
    [/^(coffee|cafe|cafes|café|cafés|coffee shop|coffee shops)$/, 'coffee'],
    [/^(food|restaurant|restaurants|eat|lunch|dinner|breakfast|fast food)$/, 'food'],
    [/^(parking|parking lot|parking lots|parking garage|parking garages|car park|car parks)$/, 'parking'],   // never "park": a park is a place
  ];
  /** The kind a typed query asks for, or null. An electric car asking for gas gets its chargers. */
  function categoryOf(q, electric) {
    const s = String(q || '').toLowerCase().replace(/\s+(near me|nearby|near here|around here)$/, '').replace(/\s+/g, ' ').trim();
    for (const [re, cat] of WORDS) if (re.test(s)) return cat === 'gas' && electric ? 'charge' : cat;
    return null;
  }

  /**
   * The spots to read tiles at for `km` around (lat, lon): a grid every 2 km; stages.js poisAll reads the z14 tile under
   * each and its neighbours within 0.4 km, so the tiles cover the circle. Cockpit asks 3 km first, 8 km when that finds
   * fewer than three (the same rows the car's Places use: the map's own tiles, no search service).
   */
  function gridPoints(lat, lon, km = 8, stepKm = 2) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(km > 0)) return [];
    const out = [], n = Math.ceil(km / stepKm), dLat = stepKm / 110.54, dLon = stepKm / (111.32 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (Math.hypot(i, j) * stepKm <= km + stepKm) out.push({ lat: lat + i * dLat, lon: lon + j * dLon });
    return out;
  }

  function metres(a, b) {
    const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k), y = (b.lat - a.lat) * k;
    return Math.hypot(x, y) * 6371008.8;
  }

  /**
   * The places of kind `cat` in `pois` ([{ cls, sub, name, lat, lon }]) within `km` of `here`, nearest first: at most
   * `max`, one per place (a station drawn twice in neighbouring tiles, or as a building and a point, is one). A place with
   * no name on the map says what it is (a car park: "Parking lot", as most are), never a made-up name. Rows: { label, named, lat, lon, m, kind: cat }.
   */
  function list(pois, here, cat, opts = {}) {
    const c = CATS[cat], km = opts.km || 8, max = opts.max || 8;
    if (!c || !here || !Number.isFinite(here.lat) || !Number.isFinite(here.lon)) return [];
    const rows = [];
    for (const p of pois || []) {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !c.match(p)) continue;
      const m = metres(here, p);
      if (m > km * 1000) continue;
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;
      if (rows.some((r) => metres(r, p) < (name && r.name === name ? 150 : 15))) continue;   // the same place again
      rows.push({ name, lat: p.lat, lon: p.lon, m });
    }
    rows.sort((a, b) => a.m - b.m);
    return rows.slice(0, max).map((r) => ({ label: r.name || c.unnamed || `${c.noun}, no name on the map`, named: !!r.name, lat: r.lat, lon: r.lon, m: Math.round(r.m), kind: cat }));
  }

  /** What the list says when it is empty: none within reach, or the map's places couldn't be read. */
  function emptyLine(cat, failed, km = 8, long = (m) => `${Math.round(m / 1000)} km`) {
    const c = CATS[cat];
    if (!c) return '';
    return failed ? 'Nearby places didn\'t load. Try again with a signal.' : `No ${c.label.toLowerCase()} on the map within ${long(km * 1000)}.`;
  }

  const api = { CATS, keys, categoryOf, gridPoints, list, emptyLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ApexNearby = api;
})(typeof self !== 'undefined' ? self : this);
