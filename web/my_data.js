// Your data (IDEAS Z-03 privacy dashboard, Z-04 export): what this phone holds, and your drives as GPX to take anywhere.
// Pure (tests/test_my_data.py); the page reads IndexedDB and localStorage and draws the panel.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

  /** GPX 1.1, one track per drive (name, date as the track's time); points with elevation when known. Unknown stays out. */
  function toGpx(drives) {
    const out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Vetta" xmlns="http://www.topografix.com/GPX/1/1">'];
    for (const d of drives || []) {
      const lat = d.lat || [], lon = d.lon || [], ele = d.elev || [];
      const pts = [];
      for (let i = 0; i < Math.min(lat.length, lon.length); i++) {
        if (!finite(lat[i]) || !finite(lon[i])) continue;
        pts.push(`<trkpt lat="${lat[i].toFixed(6)}" lon="${lon[i].toFixed(6)}">${finite(ele[i]) ? `<ele>${ele[i].toFixed(1)}</ele>` : ''}</trkpt>`);
      }
      if (!pts.length) continue;
      const when = typeof d.date === 'string' && !Number.isNaN(Date.parse(d.date)) ? `<time>${new Date(d.date).toISOString()}</time>` : '';
      out.push(`<trk><name>${esc(d.name || 'Drive')}</name>${when ? `<desc>${esc(d.date)}</desc>` : ''}<trkseg>${pts.join('')}</trkseg></trk>`);
    }
    out.push('</gpx>');
    return out.join('\n');
  }

  /** What the phone holds, counted. `storage` is a localStorage-like object. */
  function phoneSummary(drives, storage) {
    const read = (k, fallback) => { try { return JSON.parse(storage.getItem(k) || fallback); } catch (_) { return JSON.parse(fallback); } };
    const miles = (drives || []).reduce((s, d) => s + (Array.isArray(d.dist) && d.dist.length ? d.dist[d.dist.length - 1] : 0), 0) / 1609.344;
    const sum = {
      drives: (drives || []).length, miles: Math.round(miles * 10) / 10,
      spots: read('apex.highlights', '[]').length, zones: read('apex.privacyZones', '[]').length,
      places: read('apex.recentPlaces', '[]').length, signedIn: !!(storage.getItem('apex.session') || storage.getItem('apex.signedIn')),
    };
    // road data that had no signal to go with (road_carry.js keeps its index here): metres of road still waiting, when any
    const waitingM = Object.values(read('apex.roadCarry', '{}') || {}).reduce((t, e) => t + (e && e.n > 0 ? e.n : 0), 0) * 5;
    if (waitingM > 0) sum.waitingM = waitingM;
    return sum;
  }

  /**
   * U-126: what the phone holds as one sentence that counts only what exists ("On this phone: 3 drives (12.4 mi), 2 spots."),
   * one line when there is nothing. `long(m)` formats a distance.
   */
  function phoneText(s, long = (m) => `${(m / 1609.344).toFixed(1)} mi`) {
    const n = (k, word) => (k > 0 ? `${k} ${word}${k === 1 ? '' : 's'}` : '');
    const parts = [s.drives > 0 ? `${n(s.drives, 'drive')} (${long(s.miles * 1609.344)})` : '', n(s.spots, 'spot'), n(s.zones, 'privacy zone'), n(s.places, 'recent place'),
      s.waitingM > 0 ? `road data from ${long(s.waitingM)} waiting for signal` : ''].filter(Boolean);
    if (!parts.length) return s.signedIn ? 'Nothing on this phone yet. Friends, crews and what you shared are on the server.' : 'Nothing on this phone yet, and nothing of yours on the server.';
    return `On this phone: ${parts.join(', ')}. ` + (s.signedIn ? 'Signed in: friends, crews and what you shared are on the server.' : 'Not signed in: nothing of yours is on the server.');
  }

  /** The keys this app keeps in localStorage (cleared by "Erase everything on this phone"). */
  const keysToClear = (storage) => { const ks = []; for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith('apex.')) ks.push(k); } return ks; };

  /**
   * Offline data (IDEAS F-06): routes saved for offline (count, size) in `storage`, downloaded voices (`voiceBytes`, from the
   * Cache API, null unknown) and the browser's total (`usage`/`quota` from navigator.storage.estimate, null unknown).
   * Map tiles sit in the browser's own HTTP cache, which the app can't size or clear; it says so.
   */
  function offlineSummary(storage, voiceBytes = null, usage = null, quota = null) {
    let routes = 0, routeBytes = 0;
    try {
      const raw = storage.getItem('apex.savedRoutes');
      if (raw) { const v = JSON.parse(raw); routes = Array.isArray(v) ? v.length : 0; routeBytes = raw.length * 2; }
    } catch (_) {}
    let areas = 0, areaBytes = 0;
    try { const v = JSON.parse(storage.getItem('apex.offlineAreas') || '[]'); if (Array.isArray(v)) { areas = v.length; areaBytes = v.reduce((s, a) => s + (finite(a && a.bytes) ? a.bytes : 0), 0); } } catch (_) {}
    return { routes, routeBytes, areas, areaBytes, voiceBytes: finite(voiceBytes) ? voiceBytes : null, usage: finite(usage) ? usage : null, quota: finite(quota) ? quota : null };
  }
  const mb = (b) => (b < 0.05 * 1048576 ? '<0.1' : (b / 1048576).toFixed(1)) + ' MB';
  /** One line for Settings. */
  function offlineText(o) {
    // U-126: no scoreboard of zeros: nothing saved for offline is one short line
    if (!(o.routes > 0) && !(o.areas > 0) && !(o.voiceBytes > 0)) return 'Nothing saved for offline. Map tiles you have seen are kept by the phone\u2019s own web cache, which clears itself.';
    const parts = [];
    if (o.routes > 0) parts.push(`${o.routes} saved route${o.routes === 1 ? '' : 's'} (${mb(o.routeBytes)})`);
    if (o.areas > 0) parts.push(`${o.areas} map area${o.areas === 1 ? '' : 's'} (${mb(o.areaBytes)})`);
    if (o.voiceBytes != null && o.voiceBytes > 0) parts.push(`downloaded voices ${mb(o.voiceBytes)}`);
    let s = `Offline data: ${parts.join(', ')}.`;
    if (o.usage != null) s += ` The app uses ${mb(o.usage)} on this phone in all${o.quota ? ` (of ${Math.round(o.quota / 1073741824 * 10) / 10} GB allowed)` : ''}.`;
    return s + (o.areas > 0 ? '' : ' Other map tiles are kept by the phone\u2019s own web cache, which clears itself.');
  }

  const api = { toGpx, phoneSummary, phoneText, keysToClear, offlineSummary, offlineText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexMyData = api;
})(typeof window !== 'undefined' ? window : globalThis);
