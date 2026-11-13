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

  // Cold tyres: a tyre's rubber hardens in the cold, a summer compound most of all (below about 7 °C it loses much of its
  // grip), and on a public road it never gets hot enough to make up for it. On a dry road at 7 °C or colder, with tyres
  // the Garage doesn't name as winter ones (the score's own test, apex_core.js carGrip), the co-driver says it once a day.
  // Wet and icy roads have their own line. Unknown temperature says nothing.
  const COLD_C = 7, WINTER = /winter|snow|all[- ]?terrain|\bA\/T\b|\bM\/T\b|\bmud\b/i;
  const SUMMER = /summer|pilot sport|\bPS ?[2-5]\b|\bcup\b|RE-?71|AD0[89]|\bR-?comp|semi[- ]?slick|\btrack\b|P ?zero|Eagle F1|Potenza S/i;
  const COLD = { summer: 'Cold out. Summer tyres grip less in the cold.', any: 'Cold out. Tyres grip less until they warm.' };
  /** The cold-tyre line for a road state, temperature (°C) and the Garage car's tyres (free text), or ''. */
  function coldLine(state, tempC, tyres = null) {
    if (state !== 'dry' || !finite(tempC) || tempC > COLD_C) return '';
    const t = typeof tyres === 'string' ? tyres : '';
    if (WINTER.test(t)) return '';
    return SUMMER.test(t) ? COLD.summer : COLD.any;
  }

  const api = { stateOf, road, line, coldLine, ROAD, COLD_C };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexWetRoads = api;
})(typeof window !== 'undefined' ? window : globalThis);
