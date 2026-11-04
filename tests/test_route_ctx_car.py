"""Route context, the car (web/route_ctx/car.js): fuel-stop spacing from the Garage car's fuel and range (a hard span when a
stretch between stations is over the safe range, a planned stop before it, an ask-once when the range isn't known), EV
chargers through our Worker (no key: 'no-key'), phone signal from C's coverage channel, and the offline areas for the
no-signal stretches. Fuel stations parsed from a real Overpass answer (tests/fixtures/route_ctx)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="needs node")
FIX = ROOT / "tests" / "fixtures" / "route_ctx" / "overpass_fuel_maryville_tn.json"

PRE = f"""
const W = {json.dumps(str(ROOT / 'web'))} + '/';
const C = require(W + 'route_ctx/car.js');
const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v instanceof Float32Array || v instanceof Float64Array ? Array.from(v, (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 'NaN')) : v)));
// a straight corridor north from 35.5, -83.5, one sample every 25 m, for km kilometres
const corridor = (km, id = 'c1') => {{ const n = Math.round(km * 40) + 1, lat = new Float64Array(n), lon = new Float64Array(n), distM = new Float64Array(n);
  for (let i = 0; i < n; i++) {{ lat[i] = 35.5 + i * 25 / 110540; lon[i] = -83.5; distM[i] = i * 25; }}
  return {{ id, lat, lon, distM, etaAt: new Float64Array(n).map((_, i) => 1.7e12 + i * 1500), heading: new Float32Array(n) }}; }};
const at = (km) => ({{ lat: 35.5 + km * 1000 / 110540, lon: -83.5 + 0.002 }});      // a station ~180 m off the road at km
const mem = () => {{ const m = new Map(); return {{ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }}; }};
"""


def run(js: str):
    p = subprocess.run([NODE, "-e", PRE + f"(async () => {{ const out = await ({js}); console.log(JSON.stringify(clean(out))); }})();"],
                       capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_real_overpass_fuel_answer_parses():
    out = run(f"C.parseFuel({FIX.read_text()})")
    assert len(out) == 8 and all(35.7 < s["lat"] < 35.8 and -84.0 < s["lon"] < -83.9 for s in out)   # nodes and ways (their centre)
    assert run("C.parseFuel({ elements: [{ type: 'node' }, { type: 'way' }] })") == []


def test_car_and_safe_range():
    out = run("[C.carOf({ fuel: 'petrol', range_km: 500, label: 'MX-5' }), C.carOf({ fuel: 'steam', range_km: 10 }), C.carOf(null),"
              " C.safeKm(C.carOf({ fuel: 'petrol', range_km: 500 })), C.safeKm(C.carOf({ fuel: 'electric', range_km: 400 })), C.safeKm(C.carOf({ fuel: 'diesel' }))]")
    assert out[0] == {"fuel": "petrol", "rangeKm": 500, "electric": False, "label": "MX-5"}
    assert out[1]["fuel"] is None and out[1]["rangeKm"] is None and out[2] is None
    assert out[3] == 400 and out[4] == 300 and out[5] is None         # unknown range: no invented one


def test_fuel_gap_is_hard_with_a_planned_stop_before_it():
    """220 km: stations at 10, 60 and 200 km; a 150 km range car (safe 120): 60 -> 200 is a 140 km gap, the stop is at 60."""
    js = """(() => {
      const t = corridor(220), along = C.stationsAlong(t, [at(10), at(60), at(200)]);
      const p = C.fuelPlan(t, along, C.carOf({ fuel: 'petrol', range_km: 150 }));
      return { along: along.map((s) => Math.round(s.atM / 1000)), spans: p.spans, points: p.points.map((x) => [x.kind, Math.round(x.atM / 1000)]),
               since: [p.since[0], p.since[400], p.since[4000]], margin: p.margin[4000], longest: p.longestKm };
    })()"""
    out = run(js)
    assert out["along"] == [10, 60, 200]
    gap = [s for s in out["spans"] if s["kind"] == "fuel_gap"]
    assert len(gap) == 1 and gap[0]["hard"] is True and gap[0]["value"] == 140 and "over your safe 120 km" in gap[0]["label"]
    assert ["fuel_stop", 60] in out["points"]
    assert out["since"][0] is None and out["since"][1] == 0 and out["since"][2] == 40   # before the first station: unknown
    assert abs(out["margin"] - (1 - 40 / 120)) < 1e-3 and out["longest"] == 140


def test_greedy_stops_and_the_first_stretch():
    """300 km, stations every 50 km from 90, range 200 (safe 160): fill at 90, then at 240; first fuel at 90 km > safe/2."""
    js = """(() => {
      const t = corridor(300), along = C.stationsAlong(t, [90, 140, 190, 240, 290].map(at));
      const p = C.fuelPlan(t, along, C.carOf({ fuel: 'petrol', range_km: 200 }));
      const none = C.fuelPlan(t, along, C.carOf({ fuel: 'petrol' }));
      return { kinds: p.spans.map((s) => s.kind), stops: p.points.filter((x) => x.kind === 'fuel_stop').map((x) => Math.round(x.atM / 1000)),
               none: [none.spans.length, none.points.length, none.margin[8000]] };
    })()"""
    out = run(js)
    assert out["kinds"] == ["fuel_check"] and out["stops"] == [240]
    assert out["none"] == [0, 0, None]


def test_signal_from_coverage_and_offline_areas():
    js = """(() => {
      const t = corridor(30), n = t.lat.length, cov = new Float32Array(n).fill(0.9);
      for (let i = 400; i < 800; i++) cov[i] = 0.1;                      // 10 km with no signal from km 10
      for (let i = 1000; i < 1040; i++) cov[i] = NaN;                    // unknown is not "no signal"
      const s = C.signalPlan(t, cov), areas = C.offlineAreas(t, s.spans), none = C.signalPlan(t, null);
      return { spans: s.spans.map((x) => [x.kind, Math.round(x.fromM / 1000), Math.round(x.toM / 1000), x.label]), pts: s.points, areas, none: [none.spans.length, none.signal[5]] };
    })()"""
    out = run(js)
    assert out["spans"] == [["no_signal", 10, 20, "No signal for 10 km"]]
    assert out["pts"][0]["kind"] == "share_eta" and out["pts"][0]["atM"] == 8000
    assert len(out["areas"]) == 1 and 3 <= out["areas"][0]["radiusKm"] <= 25
    assert out["none"] == [0, None]


def test_ask_range_once_per_car():
    js = """(() => { const st = mem(), car = C.carOf({ fuel: 'petrol', label: 'MX-5' });
      return [C.askRangeOnce(st, car, 200), C.askRangeOnce(st, car, 200), C.askRangeOnce(st, C.carOf({ label: 'Golf' }), 100),
              C.askRangeOnce(st, C.carOf({ fuel: 'petrol', range_km: 300, label: 'S2000' }), 400)]; })()"""
    assert run(js) == [True, False, False, False]


def test_provider_ev_without_key_and_petrol_from_cache_never_block():
    js = """(async () => {
      const t = corridor(40), st = mem();
      const ev = await C.provider.fetch([t], { car: { fuel: 'electric', range_km: 300 }, storage: st, apiGet: async () => ({ status: 503, ok: false }) });
      // petrol: every tile cached as known-empty, so no network; 40 km with no station and a 60 km range car (safe 48)
      for (const k of C.tilesOf([t])) st.setItem(`apex.fuel.fuel.${k}`, JSON.stringify({ at: Date.now(), s: [] }));
      const pet = await C.provider.fetch([t], { car: { fuel: 'petrol', range_km: 60 }, storage: st, fetch: () => { throw new Error('no network'); } });
      const t0 = Date.now(), slow = await C.provider.fetch([corridor(5, 'c2')], { car: { fuel: 'petrol', range_km: 60 }, storage: mem(), fetch: () => new Promise(() => {}), budgetMs: 700 });
      return { ev: [ev.c1.status, ev.c1.note], pet: [pet.c1.status, pet.c1.spans.map((s) => s.kind)], slow: slow.c2.status, ms: Date.now() - t0 };
    })()"""
    out = run(js)
    assert out["ev"][0] == "no-key" and "NREL" in out["ev"][1]
    assert out["pet"][1] == ["fuel_check"]                            # no fuel on the way: start full
    assert out["slow"] in ("partial", "unavailable") and out["ms"] < 3000


def test_routing_car_carries_fuel_and_range_and_the_garage_has_the_fields():
    cockpit = (ROOT / "web" / "cockpit.js").read_text()
    assert "fuel: c.fuel || null, range_km: c.range_km || null" in cockpit
    ui = (ROOT / "web" / "garage_ui.js").read_text()
    assert "sel('fuel', 'Fuel', FUEL, c.fuel)" in ui and "range_km:" in ui and "Range on a full tank" in ui


def test_fuel_gap_is_hard_only_where_the_stations_are_known():
    """A gap whose tiles all answered is a hard limit; where some tiles couldn't be loaded it may be stations we missed:
    fuel_unsure, said, never enforced (the route engine drops a route only on a hard fuel_gap)."""
    js = """(async () => {
      const t = corridor(120), all = mem(), some = mem();
      const tiles = C.tilesOf([t]);
      for (const k of tiles) all.setItem(`apex.fuel.fuel.${k}`, JSON.stringify({ at: Date.now(), s: [] }));
      all.setItem(`apex.fuel.fuel.${tiles[0]}`, JSON.stringify({ at: Date.now(), s: [at(1)] }));
      tiles.forEach((k, j) => { if (j % 2 === 0) some.setItem(`apex.fuel.fuel.${k}`, JSON.stringify({ at: Date.now(), s: j === 0 ? [at(1)] : [] })); });
      const known = await C.provider.fetch([t], { car: { fuel: 'petrol', range_km: 60 }, storage: all, fetch: () => { throw new Error('no network'); } });
      const holes = await C.provider.fetch([t], { car: { fuel: 'petrol', range_km: 60 }, storage: some, fetch: () => { throw new Error('no network'); } });
      const kinds = (r) => r.c1.spans.map((s) => [s.kind, !!s.hard]);
      return { known: kinds(known), holes: kinds(holes) };
    })()"""
    out = run(js)
    assert ["fuel_gap", True] in out["known"], out
    assert ["fuel_gap", True] not in out["holes"] and ["fuel_unsure", False] in out["holes"], out
