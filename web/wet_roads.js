// Wet roads (the road today): the weather word the place plate already keeps for where you are (place_plate.js weather:
// a fresh NWS observation, Open-Meteo's now and its last 3 hours of rain; asked about every 20 minutes or 5 km, while
// driving too) says whether the road is wet or icy. On those the car stops and corners slower, so the pace notes come
// earlier (note_timing.js setRoad) and the co-driver says it once. Unknown weather changes nothing.
// Pure (tests/test_wet_roads.py); the cockpit reads the plate's data.
(function (root) {
  'use strict';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const WET = new Set(['Rain', 'Drizzle', 'Storm', 'Wet roads']), ICE_C = 1;
  // How the road changes the notes: braking (m/s², dry 3.4 = 0.35 g) and corner speed (the square root of the grip share:
  // a wet road ~70 % of dry grip, ice ~35 %).
  const ROAD = { wet: { decelMps2: 2.5, apexK: Math.sqrt(0.7) }, ice: { decelMps2: 1.5, apexK: Math.sqrt(0.35) } };
  const LINE = { wet: 'Wet roads. Notes come earlier.', ice: 'Ice risk. Notes come earlier. Go gently.' };

  /**
   * 'ice' | 'wet' | 'dry' from the plate's weather word (ApexPlacePlate.weather) and the temperature (°C), or null when
   * the word is unknown. Snow is an icy road; a wet one at 1 °C or colder is too.
   */
  function stateOf(word, tempC = null) {
    if (word === 'Snow') return 'ice';
    if (WET.has(word)) return finite(tempC) && tempC <= ICE_C ? 'ice' : 'wet';
    if (word === 'Dry' || word === 'Fog') return 'dry';
    return null;
  }

  /** What note_timing.setRoad takes for a state (null: the dry road). */
  const road = (state) => ROAD[state] || null;
  /** What the co-driver says when the road turns wet or icy ('' for dry or unknown). */
  const line = (state) => LINE[state] || '';

  const api = { stateOf, road, line, ROAD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexWetRoads = api;
})(typeof window !== 'undefined' ? window : globalThis);
