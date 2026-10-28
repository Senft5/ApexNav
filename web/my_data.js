// Your data (IDEAS Z-03 privacy dashboard, Z-04 export): what this phone holds, and your drives as GPX to take anywhere.
// Pure (tests/test_my_data.py); the page reads IndexedDB and localStorage and draws the panel.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

  /** GPX 1.1, one track per drive (name, date as the track's time); points with elevation when known. Unknown stays out. */
  function toGpx(drives) {
    const out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="ApexNav" xmlns="http://www.topografix.com/GPX/1/1">'];
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
    return {
      drives: (drives || []).length, miles: Math.round(miles * 10) / 10,
      spots: read('apex.highlights', '[]').length, zones: read('apex.privacyZones', '[]').length,
      places: read('apex.recentPlaces', '[]').length, signedIn: !!(storage.getItem('apex.session') || storage.getItem('apex.signedIn')),
    };
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
    return { routes, routeBytes, voiceBytes: finite(voiceBytes) ? voiceBytes : null, usage: finite(usage) ? usage : null, quota: finite(quota) ? quota : null };
  }
  const mb = (b) => (b < 0.05 * 1048576 ? '<0.1' : (b / 1048576).toFixed(1)) + ' MB';
  /** One line for Settings. */
  function offlineText(o) {
    const parts = [`${o.routes} saved route${o.routes === 1 ? '' : 's'} (${mb(o.routeBytes)})`];
    if (o.voiceBytes != null && o.voiceBytes > 0) parts.push(`downloaded voices ${mb(o.voiceBytes)}`);
    let s = `Offline data: ${parts.join(', ')}.`;
    if (o.usage != null) s += ` The app uses ${mb(o.usage)} on this phone in all${o.quota ? ` (of ${Math.round(o.quota / 1073741824 * 10) / 10} GB allowed)` : ''}.`;
    return s + ' Map tiles are kept by the phone\u2019s own web cache, which clears itself.';
  }

  const api = { toGpx, phoneSummary, keysToClear, offlineSummary, offlineText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexMyData = api;
})(typeof window !== 'undefined' ? window : globalThis);
