// What VoiceOver reads for the road book strip and the instruments (panel round 2 AM-2, AM-3). Pure: words in, words out
// (tests/test_say.py). The strip is said in the grammar's own words, the call the co-driver speaks (n.call), with its
// distance and unit spelled out, and only changes when the lead note changes or its distance crosses a band, so a reader
// who swipes to it hears it once. It is never a live region: the co-driver speaks to the driver, and this must not talk
// over it. Every instrument is named value first ("48 miles per hour, Sight"), with the unit spelled out and "unknown"
// said for a dash.
(function (root) {
  'use strict';
  const UNIT_WORDS = { ft: 'feet', mi: 'miles', m: 'metres', km: 'kilometres', yd: 'yards', 'mph': 'miles per hour', 'km/h': 'kilometres per hour' };
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const unitWord = (u, n) => {
    const w = UNIT_WORDS[String(u || '').toLowerCase()] || String(u || '').toLowerCase();
    return n === 1 ? w.replace(/(miles|metres|kilometres|feet|yards)/, (x) => ({ miles: 'mile', metres: 'metre', kilometres: 'kilometre', feet: 'foot', yards: 'yard' }[x])) : w;
  };

  /** A strip distance ("350", "FT"; ".4", "MI") said with its unit, banded so it changes rarely: feet to the 100 under a
   *  mile's tenth, metres to the 50; miles and kilometres as the strip prints them. '' when there is none. */
  function distance(dist, unit) {
    let v = parseFloat(String(dist == null ? '' : dist).replace(/^\./, '0.'));
    const u = String(unit || '').toLowerCase();
    if (!finite(v) || !u) return '';
    if (u === 'ft' && v >= 100) v = Math.round(v / 100) * 100;
    if (u === 'm' && v >= 50) v = Math.round(v / 50) * 50;
    if (u === 'ft' || u === 'm' || u === 'yd') v = Math.round(v);
    return `${v} ${unitWord(u, v)}`;
  }

  const sentence = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  /** The road book, said: "Careful, hairpin left, long, in 400 feet; then easy left in 1.3 miles". Quiet: "Clear. <line>". */
  function strip(notes) {
    const list = Array.isArray(notes) ? notes.slice(0, 3) : [];
    if (!list.length) return sentence(`Clear. ${(notes && notes.quietText) || ''}`);
    return list.map((n, i) => {
      const call = sentence(n.call || n.code || n.type || 'Note'), d = distance(n.dist, n.unit);
      const said = d ? `${call} in ${d}` : call;
      return i === 0 ? said : `then ${said.charAt(0).toLowerCase()}${said.slice(1)}`;
    }).join('; ');
  }

  /** "48 miles per hour" / "unknown". */
  const speed = (v, unit = 'mph') => (finite(v) ? `${Math.round(v)} ${unitWord(unit, Math.round(v))}` : 'unknown');
  /** Value first, then what it is: "48 miles per hour, Speed". */
  const named = (value, name) => `${value}, ${name}`;

  /** The binnacle's instruments, named for VoiceOver. `d` is the cluster's frame (instruments.js mountCluster). */
  function instruments(d, unit = 'mph', longUnit = 'mi') {
    const both = d.sightQuiet ? [] : [d.paceMph, d.sightMph].filter(finite);
    const sight = both.length ? Math.min(...both) : null;
    const over = !d.sightOpen && sight != null && finite(d.speedMph) && d.speedMph > sight + 1;
    const lat = finite(d.latG) ? d.latG : null, lon = finite(d.lonG) ? d.lonG : null;
    let grip = 'unknown';
    if (lat != null && lon != null) {
      const g = Math.hypot(lat, lon), parts = [];
      if (Math.abs(lon) >= 0.05) parts.push(lon < 0 ? 'braking' : 'accelerating');
      if (Math.abs(lat) >= 0.05) parts.push(`turning ${lat > 0 ? 'left' : 'right'}`);
      grip = `${g.toFixed(1)} g${parts.length ? ' ' + parts.join(' and ') : ''}`;
      if (finite(d.camberDeg)) grip += `, bank ${Math.round(Math.abs(d.camberDeg))} degrees${Math.round(d.camberDeg) ? (d.camberDeg > 0 ? ' into the turn' : ' off-camber') : ''}`;
    }
    const trip = finite(d.tripMi) ? `${Math.max(0, d.tripMi).toFixed(1)} ${unitWord(longUnit)}${finite(d.totalMi) ? ` of ${d.totalMi.toFixed(1)}` : ''}` : 'unknown';
    return {
      speed: named(speed(d.speedMph, unit), 'Speed'),
      limit: named(speed(d.limitMph, unit), 'Speed limit'),
      sight: named(d.sightOpen ? 'Open' : speed(sight, unit), 'Sight') + (over ? ', slow down' : ''),
      grip: named(grip, 'Grip'),
      score: named(finite(d.score) ? String(Math.round(d.score)) : 'unknown', 'Vetta Score'),
      trip: named(trip, 'Trip'),
    };
  }
  const SIGHT_MEANS = 'The speed you could stop from within what you can see ahead.';

  const api = { strip, distance, speed, named, instruments, unitWord, SIGHT_MEANS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSay = api;
})(typeof window !== 'undefined' ? window : globalThis);
