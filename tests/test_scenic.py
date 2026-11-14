"""Along the route (web/scenic.js, IDEAS R-24, R-23): viewpoints, cafés and fuel within reach of the road, in road order,
one per kind per stretch (a named one kept), and the longest stretch with no fuel."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const S = require(process.argv[1] + '/web/scenic.js');
// a straight road north, 130 km, 5 m samples
const n = 26001, N = (m) => 35 + m / 110540, E = (m) => -84 + m / (111320 * Math.cos(35 * Math.PI / 180));
const t = { lat: Array.from({ length: n }, (_, i) => N(i * 5)), lon: Array(n).fill(-84), dist: Array.from({ length: n }, (_, i) => i * 5) };
const pois = [
  { kind: 'view', name: null, lat: N(10000), lon: E(200) }, { kind: 'view', name: 'Big Overlook', lat: N(10100), lon: E(-150) },   // one stop, the named one
  { kind: 'view', name: 'Far', lat: N(20000), lon: E(900) },                                                                      // too far off the road
  { kind: 'cafe', name: 'Bean', lat: N(5000), lon: E(100) }, { kind: 'fuel', name: 'Shell', lat: N(15000), lon: E(50) },
  { kind: 'fuel', name: 'BP', lat: N(110000), lon: E(30) }, { kind: 'bank', name: 'x', lat: N(1000), lon: E(0) },
];
const list = S.along(pois, t), total = t.dist[n - 1];
console.log(JSON.stringify({ list: list.map((p) => [p.kind, p.name, Math.round(p.m / 100) * 100]), gap: S.fuelGap(list, total), summary: S.summary(list, total),
  noFuelShort: S.summary(S.along(pois.filter((p) => p.kind !== 'fuel'), { ...t, lat: t.lat.slice(0, 4001), lon: t.lon.slice(0, 4001), dist: t.dist.slice(0, 4001) }), 20000),
  none: S.summary([], 10000),
  places: S.places([...list, { kind: 'cafe', name: '  ', lat: N(200), lon: E(0), m: 40, offM: 12 }].sort((a, b) => a.m - b.m)),
  imperial: S.places(list.slice(0, 1), { long: (m) => (m / 1609.344).toFixed(1) + ' mi', short: (m) => Math.round(m / 0.3048 / 50) * 50 + ' ft' }),
  ask: [S.nextAnswer(list, 0, 'fuel'), S.nextAnswer(list, 14980, 'fuel'), S.nextAnswer(list, 6000, 'cafe'), S.nextAnswer(null, 0, 'cafe'),
    S.nextAnswer([{ kind: 'fuel', name: null, m: 3000 }], 1000, 'fuel'), S.nextAnswer(list, 0, 'bank')],
  line: S.placeLine(S.places(list)[0]), lineUnnamed: S.placeLine(S.places([{ kind: 'fuel', name: null, lat: 35, lon: -84, m: 2500, offM: 90 }])[0]),
  // the owner, 2026-11-04: a pile of FUEL stamps in a town, two cafés and a viewpoint on top of them, one fuel far off,
  // one off the screen; 40x16 px stamps
  clutter: S.declutter([
    ...Array.from({ length: 8 }, (_, k) => ({ kind: 'fuel', m: 1000 + k * 50, x: 100 + k * 6, y: 200 + k * 3, w: 40, h: 16 })),
    { kind: 'cafe', m: 1100, x: 110, y: 205, w: 40, h: 16 }, { kind: 'view', named: true, m: 1200, x: 104, y: 202, w: 90, h: 16 },
    { kind: 'cafe', m: 9000, x: 300, y: 500, w: 40, h: 16 }, { kind: 'fuel', m: 30000, x: 320, y: 700, w: 40, h: 16 },
    { kind: 'fuel', m: 60000, x: 900, y: 100, w: 40, h: 16 }], { w: 390, h: 844 }),
  // more fuel along the road than is useful: four kept, spread along it (the first, the farthest, then the middles)
  // walkthrough 2026-11-12: two LPR stamps on one junction and a café on them; an SPD beside them; a café clear of all
  notes: S.declutter([{ kind: 'note:LPR', fixed: true, m: 500, x: 200, y: 300, w: 44, h: 22 }, { kind: 'note:LPR', fixed: true, m: 520, x: 204, y: 304, w: 44, h: 22 },
    { kind: 'cafe', m: 510, x: 206, y: 306, w: 40, h: 16 }, { kind: 'note:SPD', fixed: true, m: 530, x: 210, y: 300, w: 44, h: 22 },
    { kind: 'cafe', m: 3000, x: 50, y: 600, w: 40, h: 16 }], { w: 390, h: 844 }),
  spread: S.declutter(Array.from({ length: 9 }, (_, k) => ({ kind: 'fuel', m: k * 10000, x: 20 + k * 42, y: 100 + (k % 2) * 300, w: 36, h: 16 })), { w: 390, h: 844 }) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_along_the_road(out):
    assert out["list"] == [["cafe", "Bean", 5000], ["view", "Big Overlook", 10100], ["fuel", "Shell", 15000], ["fuel", "BP", 110000]]


def test_fuel_gap_and_summary(out):
    assert {k: round(v, -2) for k, v in out["gap"].items()} == {"m": 95000, "fromM": 15000, "toM": 110000}   # 30 m sampling
    assert out["summary"] == "1 viewpoint · 1 café · 2 fuel stops · no fuel from mi 9 to 68"
    assert out["noFuelShort"] == "1 viewpoint · 1 café"          # 20 km with no fuel isn't worth a warning
    assert out["none"] == ""


def test_each_place_is_listed_by_its_name(out):
    # the owner, 2026-11-11: tap the Along line for the cafés and stations by name; an unnamed one says so, never a made-up name
    rows = out["places"]
    assert [r["title"] for r in rows] == ["Café, no name on the map", "Bean", "Big Overlook", "Shell", "BP"]
    assert [r["named"] for r in rows] == [False, True, True, True, True]
    assert rows[0]["at"] == "at the start" and rows[0]["off"] == "beside the road"
    assert rows[1]["kindName"] == "Café" and rows[1]["at"] == "5.0 km in"
    assert out["imperial"][0]["at"] == "3.1 mi in" and out["imperial"][0]["off"].endswith("ft off the road")
    assert out["line"] == "Bean · Café · 5.0 km in"
    assert out["lineUnnamed"] == "Fuel station · 2.5 km in"


def test_the_next_one_by_name_when_asked(out):
    # Siri, "where's the next gas station": the next one past you along the route, by its name; none ahead, no route
    assert out["ask"] == ["Next fuel: Shell, in 15.0 km.", "Next fuel: Shell, here.", "No cafés ahead on this route.",
                          "Plan a route to hear the cafés along it.", "Next fuel in 2.0 km, no name on the map.", ""]


def test_overlapping_pins_hide_keeping_the_most_useful(out):
    # the named viewpoint wins the town's pile; one fuel stamp of the eight is left near it only if it doesn't touch it
    c = out["clutter"]
    assert c[9] is True and c[8] is False                         # the viewpoint over the café on top of it
    assert sum(c[:8]) == 0                                        # every FUEL in the pile touches the viewpoint: none
    assert c[10] is True and c[11] is True                        # the café and the fuel far off stay
    assert c[12] is True                                          # off the screen: as it was
    s = out["spread"]
    assert sum(s) == 4 and s[0] and s[8]                          # four of nine, the first and the last among them


def test_waterfalls_from_openstreetmap():
    """IDEAS R-24: the map's tiles have no waterfalls, so they are asked of OpenStreetMap (Overpass) for the route's box:
    natural=waterfall or waterway=waterfall, a node or a way by its centre, one per place. Along the road (within 400 m)
    they count on the Along line after viewpoints, are listed by name and rank after viewpoints on the map."""
    src = r"""
const S = require(process.argv[1] + '/web/scenic.js');
const n = 4001, N = (m) => 35 + m / 110540, E = (m) => -84 + m / (111320 * Math.cos(35 * Math.PI / 180));
const t = { lat: Array.from({ length: n }, (_, i) => N(i * 5)), lon: Array(n).fill(-84), dist: Array.from({ length: n }, (_, i) => i * 5) };
const json = { elements: [
  { type: 'node', id: 1, lat: N(3000), lon: E(300), tags: { natural: 'waterfall', name: ' Looking Glass Falls ' } },
  { type: 'node', id: 2, lat: N(3000), lon: E(300), tags: { waterway: 'waterfall' } },                // the same place twice
  { type: 'way', id: 3, center: { lat: N(9000), lon: E(-50) }, tags: { waterway: 'waterfall' } },     // a way: its centre, no name
  { type: 'node', id: 4, lat: N(12000), lon: E(800), tags: { natural: 'waterfall', name: 'Far' } },   // too far off the road
  { type: 'way', id: 5, tags: { natural: 'waterfall' } },                                             // no position
] };
const falls = S.fallsFrom(json), list = S.along(falls.concat([{ kind: 'view', name: 'Top', lat: N(1000), lon: E(0) }]), t);
console.log(JSON.stringify({ q: S.fallsQuery(35, -84.1, 35.2, -83.9), falls, list: list.map((p) => [p.kind, p.name]), summary: S.summary(list, 20000),
  rows: S.places(list).map((r) => [r.title, r.kindName]), none: S.fallsFrom(null),
  shown: S.declutter([{ kind: 'falls', m: 1, x: 50, y: 50 }, { kind: 'cafe', m: 2, x: 52, y: 50 }, { kind: 'view', m: 3, x: 300, y: 50 }]) }));
"""
    r = json.loads(subprocess.run([NODE, "-e", src, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["q"] == ('[out:json][timeout:20];(nwr["natural"="waterfall"](35.00000,-84.10000,35.20000,-83.90000);'
                      'nwr["waterway"="waterfall"](35.00000,-84.10000,35.20000,-83.90000););out center 400;')
    assert [(f["name"], f["kind"]) for f in r["falls"]] == [("Looking Glass Falls", "falls"), (None, "falls"), ("Far", "falls")]
    assert r["list"] == [["view", "Top"], ["falls", "Looking Glass Falls"], ["falls", None]]
    assert r["summary"].startswith("1 viewpoint · 2 waterfalls")
    assert r["rows"][1:] == [["Looking Glass Falls", "Waterfall"], ["Waterfall, no name on the map", "Waterfall"]]
    assert r["none"] == []
    assert r["shown"] == [True, False, True]                                 # a waterfall goes before a café it would touch



def test_waterfalls_from_the_regions_built_list():
    """Inside the built region the waterfalls come from GET /api/ctx/falls.json (tools/osm_ctx/falls.py), not Overpass: those
    in the box, as fallsFrom gives them. A box reaching a 0.25 degree cell the list doesn't cover (across the border) is
    null, so the phone asks Overpass instead of saying "no waterfalls" where the list simply stops."""
    src = r"""
const S = require(process.argv[1] + '/web/scenic.js');
const doc = { built: '2026-11-14', bundle: 0.25, cells: [[156, -339], [156, -338]], falls: [[39.1, -84.6, 'Shaker Run Falls'], [39.2, -84.4, null], [39.9, -84.4, 'Away']] };
console.log(JSON.stringify({ in: S.fallsInRegion(doc, 39.0, -84.7, 39.24, -84.3), part: S.fallsInRegion(doc, 39.0, -84.7, 39.3, -84.3),
  none: S.fallsInRegion(null, 39, -84.7, 39.2, -84.3), bad: S.fallsInRegion({ cells: [] }, 39, -84.7, 39.2, -84.3),
  empty: S.fallsInRegion({ ...doc, falls: [] }, 39.0, -84.7, 39.24, -84.3) }));
"""
    r = json.loads(subprocess.run([NODE, "-e", src, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["in"] == [{"kind": "falls", "name": "Shaker Run Falls", "lat": 39.1, "lon": -84.6}, {"kind": "falls", "name": None, "lat": 39.2, "lon": -84.4}]
    assert r["part"] is None, "39.3 reaches a cell the list doesn't cover"
    assert r["none"] is None and r["bad"] is None
    assert r["empty"] == [], "covered and none there: known none, not unknown"

CHARGERS = r"""
const S = require(process.argv[1] + '/web/scenic.js');
const n = 26001, N = (m) => 35 + m / 110540;
const t = { lat: Array.from({ length: n }, (_, i) => N(i * 5)), lon: Array(n).fill(-84), dist: Array.from({ length: n }, (_, i) => i * 5) };
const pois = [{ kind: 'fuel', name: 'Shell', lat: N(5000), lon: -84 }, { kind: 'charge', name: 'Supercharger', lat: N(100000), lon: -84 },
  { kind: 'cafe', name: 'Bean', lat: N(6000), lon: -84 }];
const total = t.dist[n - 1];
const petrol = S.along(S.forCar(pois, { fuel: 'petrol' }), t), none = S.along(S.forCar(pois, null), t), ev = S.along(S.forCar(pois, { fuel: 'electric' }), t);
console.log(JSON.stringify({ petrol: petrol.map((p) => p.kind), none: none.map((p) => p.kind), ev: ev.map((p) => p.kind),
  petrolLine: S.summary(petrol, total), evLine: S.summary(ev, total, { electric: true }),
  ask: S.nextAnswer(ev, 0, 'charge'), title: S.places(ev)[1].kindName }));
"""


def test_chargers_are_not_fuel_stops():
    """The tiles file EV chargers under fuel: a petrol car (or none in the Garage) never counts one as a fuel stop, and an
    electric car's line counts its chargers and warns of a stretch with none."""
    r = json.loads(subprocess.run([NODE, "-e", CHARGERS, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["petrol"] == ["fuel", "cafe"] and r["none"] == ["fuel", "cafe"]
    assert r["ev"] == ["cafe", "charge"]
    assert r["petrolLine"] == "1 café · 1 fuel stop · no fuel for the last 78 mi"
    assert r["evLine"] == "1 café · 1 charger · no charger for the first 62 mi"
    assert r["ask"] == "Next charger: Supercharger, in 100.0 km."
    assert r["title"] == "EV charger"


def test_route_note_stamps_always_show_and_keep_pins_off(out):
    # a camera's stamp is a route note: never hidden by a café; the same word twice on one spot shows once; another word
    # (SPD) on top of it still shows; a café clear of them all stays
    assert out["notes"] == [True, False, False, True, True]
