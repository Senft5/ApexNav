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
      places: read('apex.recentPlaces', '[]').length, signedIn: !!storage.getItem('apex.session'),
    };
  }

  /** The keys this app keeps in localStorage (cleared by "Erase everything on this phone"). */
  const keysToClear = (storage) => { const ks = []; for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith('apex.')) ks.push(k); } return ks; };

  const api = { toGpx, phoneSummary, keysToClear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexMyData = api;
})(typeof window !== 'undefined' ? window : globalThis);
