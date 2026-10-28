// Garage car lookup (IDEAS S-21): fill a car's specs so people only change what differs (colour, mods, tyres).
// - VIN: NHTSA vPIC (free, no key, CORS open) decodes year, make, model, trim, drive, gearbox and often power.
// - Makes and models for the typed year: vPIC too.
// - Weight (and power when vPIC has none) from a small table of typical factory specs for common enthusiast cars,
//   labelled "typical" in the form; anything not known stays blank, never guessed.
// The parsing and matching are pure (tested in tests/test_car_lookup.py); the fetches take the page's fetch.
(function (root) {
  'use strict';
  const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';
  const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;   // no I, O or Q

  // Typical factory specs (base trim unless named). kg is curb weight; lb shown in the form. Ranges are model years.
  // [make, model, trim or '', fromYear, toYear, hp, kg, drive, gearbox ('manual' when one was offered)]
  const SPECS = [
    ['Mazda', 'MX-5', '', 2019, 2026, 181, 1060, 'rwd', 'manual'],
    ['Mazda', 'MX-5', '', 2016, 2018, 155, 1050, 'rwd', 'manual'],
    ['Mazda', 'MX-5 Miata', '', 1990, 1993, 116, 950, 'rwd', 'manual'],
    ['Toyota', 'GR86', '', 2022, 2026, 228, 1275, 'rwd', 'manual'],
    ['Subaru', 'BRZ', '', 2022, 2026, 228, 1270, 'rwd', 'manual'],
    ['Toyota', '86', '', 2017, 2020, 205, 1255, 'rwd', 'manual'],
    ['Scion', 'FR-S', '', 2013, 2016, 200, 1250, 'rwd', 'manual'],
    ['Toyota', 'GR Supra', '3.0', 2021, 2026, 382, 1540, 'rwd', 'auto'],
    ['Toyota', 'GR Supra', '2.0', 2021, 2026, 255, 1415, 'rwd', 'auto'],
    ['Toyota', 'GR Corolla', '', 2023, 2026, 300, 1475, 'awd', 'manual'],
    ['Honda', 'Civic', 'Type R', 2023, 2026, 315, 1430, 'fwd', 'manual'],
    ['Honda', 'Civic', 'Type R', 2017, 2021, 306, 1415, 'fwd', 'manual'],
    ['Honda', 'Civic', 'Si', 2022, 2026, 200, 1340, 'fwd', 'manual'],
    ['Honda', 'S2000', '', 2004, 2009, 237, 1260, 'rwd', 'manual'],
    ['Honda', 'S2000', '', 2000, 2003, 240, 1250, 'rwd', 'manual'],
    ['Acura', 'Integra', 'Type S', 2024, 2026, 320, 1460, 'fwd', 'manual'],
    ['Volkswagen', 'Golf GTI', '', 2022, 2026, 241, 1460, 'fwd', 'auto'],
    ['Volkswagen', 'Golf R', '', 2022, 2026, 315, 1545, 'awd', 'auto'],
    ['Hyundai', 'Elantra N', '', 2022, 2026, 276, 1415, 'fwd', 'manual'],
    ['Hyundai', 'Veloster N', '', 2019, 2022, 275, 1400, 'fwd', 'manual'],
    ['Subaru', 'WRX', '', 2022, 2026, 271, 1530, 'awd', 'manual'],
    ['Nissan', 'Z', '', 2023, 2026, 400, 1590, 'rwd', 'manual'],
    ['Ford', 'Mustang', 'GT', 2024, 2026, 480, 1750, 'rwd', 'manual'],
    ['Ford', 'Focus RS', '', 2016, 2018, 350, 1600, 'awd', 'manual'],
    ['Ford', 'Fiesta ST', '', 2014, 2019, 197, 1220, 'fwd', 'manual'],
    ['Chevrolet', 'Corvette', 'Stingray', 2020, 2026, 490, 1600, 'rwd', 'dct'],
    ['Chevrolet', 'Camaro', 'SS', 2016, 2024, 455, 1690, 'rwd', 'manual'],
    ['Porsche', '718 Cayman', '', 2017, 2026, 300, 1365, 'rwd', 'manual'],
    ['Porsche', '911', 'Carrera', 2020, 2026, 379, 1505, 'rwd', 'dct'],
    ['BMW', 'M2', '', 2023, 2026, 453, 1725, 'rwd', 'manual'],
    ['BMW', 'M3', '', 2021, 2026, 473, 1730, 'rwd', 'manual'],
  ];

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const titleCase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bBmw\b/, 'BMW').replace(/\bGmc\b/, 'GMC');
  const blank = (v) => (v == null || String(v).trim() === '' || /^not applicable$/i.test(String(v).trim()) ? null : String(v).trim());

  function driveOf(s) {
    const t = String(s || '').toLowerCase();
    if (/all|4wd|4x4|awd|four/.test(t)) return 'awd';
    if (/front|fwd/.test(t)) return 'fwd';
    if (/rear|rwd/.test(t)) return 'rwd';
    return null;
  }
  function gearboxOf(s) {
    const t = String(s || '').toLowerCase();
    if (/dual.?clutch|dct|automated manual/.test(t)) return 'dct';
    if (/manual/.test(t)) return 'manual';
    if (/auto|cvt/.test(t)) return 'auto';
    return null;
  }

  /** One vPIC DecodeVinValues result row -> the garage's fields; unknown stays null. */
  function fromVin(row) {
    if (!row) return null;
    const year = parseInt(row.ModelYear, 10), hp = Math.round(parseFloat(row.EngineHP));
    const out = {
      year: Number.isFinite(year) ? year : null, make: blank(row.Make) && titleCase(row.Make), model: blank(row.Model), trim: blank(row.Trim),
      power_hp: Number.isFinite(hp) && hp > 0 ? hp : null, drivetrain: driveOf(row.DriveType), transmission: gearboxOf(row.TransmissionStyle),
    };
    return out.make && out.model ? out : null;
  }

  /** Typical specs for a year/make/model(/trim), or null. Trim-specific rows win over the base row. */
  function specFor({ year, make, model, trim }) {
    const y = Number(year), mk = norm(make), md = norm(model), tr = norm(trim);
    if (!mk || !md) return null;
    const hits = SPECS.filter(([m, mo, t, y0, y1]) => norm(m) === mk && (norm(mo) === md || (md.startsWith(norm(mo)) && norm(mo).length >= 2))
      && (!Number.isFinite(y) || (y >= y0 && y <= y1)) && (!t || (tr && tr.includes(norm(t))) || md.includes(norm(t))));
    if (!hits.length) return null;
    const best = hits.find((h) => h[2]) || hits[0];
    return { power_hp: best[5], weight_kg: best[6], drivetrain: best[7], transmission: best[8], typical: true };
  }

  /** What the form should show after a lookup: the found values fill the car's spec fields; what only the owner knows
   *  (nickname, colour, tyres, mods) and anything the lookup didn't find is kept. */
  function merge(car, found) {
    const out = { ...car };
    for (const k of ['year', 'make', 'model', 'trim', 'power_hp', 'weight_kg', 'drivetrain', 'transmission']) {
      if (found && found[k] != null && found[k] !== '') out[k] = found[k];
    }
    return out;
  }

  async function decodeVin(vin, fetchFn) {
    const v = String(vin || '').trim().toUpperCase();
    if (!VIN_RE.test(v)) return { error: 'bad_vin' };
    try {
      const r = await fetchFn(`${VPIC}/DecodeVinValues/${v}?format=json`);
      if (!r.ok) return { error: 'offline' };
      const car = fromVin(((await r.json()).Results || [])[0]);
      if (!car) return { error: 'not_found' };
      const spec = specFor(car);
      return { car: { ...car, power_hp: car.power_hp ?? (spec && spec.power_hp), weight_kg: spec ? spec.weight_kg : null,
                      drivetrain: car.drivetrain ?? (spec && spec.drivetrain), transmission: car.transmission ?? (spec && spec.transmission) },
               typical: !!spec };
    } catch (_) { return { error: 'offline' }; }
  }

  async function models(make, year, fetchFn) {
    if (!blank(make) || !(Number(year) > 1950)) return [];
    try {
      const r = await fetchFn(`${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make.trim())}/modelyear/${Number(year)}?format=json`);
      if (!r.ok) return [];
      return [...new Set(((await r.json()).Results || []).map((x) => blank(x.Model_Name)).filter(Boolean))].sort();
    } catch (_) { return []; }
  }

  const MAKES = [...new Set(SPECS.map((s) => s[0]))].sort();
  const api = { decodeVin, models, specFor, fromVin, merge, driveOf, gearboxOf, SPECS, MAKES, VIN_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCarLookup = api;
})(typeof window !== 'undefined' ? window : globalThis);
