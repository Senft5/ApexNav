"""Road pages (web/road_page.js, IDEAS Q-13): archetype, axes, confidence and climb for a stage; unknown stays unknown."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const Core = require(process.argv[1] + '/web/apex_core.js'), P = require(process.argv[1] + '/web/road_page.js');
// switchbacks: a climb of tight alternating hairpins
const lat = [], lon = [];
let x = 0, y = 0, h = Math.PI / 2;
const step = (n, turn) => { for (let i = 0; i < n; i++) { h += turn; x += 5 * Math.cos(h); y += 5 * Math.sin(h); lat.push(35 + y / 110540); lon.push(-83 + x / (111320 * Math.cos(35 * Math.PI / 180))); } };
step(20, 0);
for (let k = 0; k < 8; k++) { step(10, (k % 2 ? 1 : -1) * Math.PI / 10); step(16, 0); }
step(20, 0);
const s = { lat, lon, name: 'Test Pass', junctionsPerKm: 0.4 };
const rs = Core.resamplePolyline(lat, lon, 5);
const elev = rs.lat.map((_, i) => 600 + i * 0.6);
const d = P.describe(Core, s, { elev, measured: { coverage: 0.7, avgPasses: 3 }, surf: 82 });
const bare = P.describe(Core, { lat, lon }, {});
const U = require(process.argv[1] + '/web/units.js');
console.log(JSON.stringify({ d, bare, head: P.headline(d), meters: P.meters(d), bareMeters: P.meters(bare), facts: P.facts(d), bareFacts: P.facts(bare),
  one: P.facts({ ...d, corners: 5, hairpins: 1 }), some: P.facts({ ...d, corners: 9, hairpins: 3 }), none: P.facts({ ...d, hairpins: 0 }),
  // what the sheet used to pass for the climb: ApexUnits.short is an object, and the line read "climbing [object Object]"
  objHead: P.headline(d, undefined, (m) => U.short(m)), ftHead: P.headline(d, undefined, (m) => `${Math.round(m * 3.28084)} ft`) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_a_switchback_climb(out):
    d = out["d"]
    assert d["archetype"] == "Switchbacks" and d["hairpins"] >= 4
    assert d["confidence"] == "L2" and d["surf"] == 82 and d["clear"] == 90
    assert d["climb"] > 100 and d["drop"] == 0
    assert out["head"].startswith("Switchbacks · ") and "climbing" in out["head"]
    assert 0 <= d["tech"] <= 100 and 0 <= d["flow"] <= 100


def test_unknown_stays_unknown(out):
    b = out["bare"]
    assert b["confidence"] == "L0" and b["surf"] is None and b["clear"] is None and b["climb"] is None
    m = {x["key"]: x for x in out["bareMeters"]}
    assert m["surf"]["value"] is None and m["clear"]["value"] is None        # drawn "--" with an empty bar, never a guess
    assert "not measured" in m["surf"]["hint"] and "aren't counted" in m["clear"]["hint"]
    assert isinstance(m["tech"]["value"], int) and isinstance(m["flow"]["value"], int)
    assert dict(out["bareFacts"])["How sure"] == "From the map only"


def test_the_sheet_speaks_plainly(out):
    # 2026-11-10: the sheet said TECH, FLOW, SURF, CLEAR and "Confidence: L0 · From the map only"
    m = out["meters"]
    assert [x["label"] for x in m] == ["Technical", "Flow", "Surface", "Clear road"]
    assert all(x["hint"] and 0 <= x["value"] <= 100 for x in m)
    assert {x["key"]: x["value"] for x in m}["surf"] == 82
    f = dict(out["facts"])
    assert f["How sure"] == "Measured by members on most of it"
    assert not any("L0" in v or "L1" in v or "L2" in v for v in f.values())
    assert f["Corners"].endswith(", all hairpins") or " · " in f["Corners"]
    assert dict(out["one"])["Corners"] == "5 · 1 hairpin" and dict(out["some"])["Corners"] == "9 · 3 hairpins"
    assert "hairpin" not in dict(out["none"])["Corners"]


def test_the_climb_is_a_height_in_words(out):
    assert "[object Object]" in out["objHead"]                               # why the formatter must return text
    assert out["ftHead"].endswith(" ft") and "object" not in out["ftHead"]
    import pathlib
    js = (pathlib.Path(ROOT) / "web" / "cockpit.js").read_text(encoding="utf-8")
    assert "ApexRoadPage.headline(d, (km) => ApexUnits.long(km * 1000, 1), heightLabel)" in js


CHAR_RUNNER = r"""
const Core = require(process.argv[1] + '/web/apex_core.js'), P = require(process.argv[1] + '/web/road_page.js');
// 3 km straight, then alternating bends (esses) for about 1.4 km, then 3 km straight
const lat = [], lon = []; let x = 0, y = 0, h = Math.PI / 2;
const step = (n, turn) => { for (let i = 0; i < n; i++) { h += turn; x += 5 * Math.cos(h); y += 5 * Math.sin(h); lat.push(35 + y / 110540); lon.push(-83 + x / 91190); } };
step(600, 0); for (let k = 0; k < 14; k++) step(20, (k % 2 ? 1 : -1) * 0.06); step(600, 0);
const rs = Core.resamplePolyline(lat, lon, 5), { kappa } = Core.computeCurvature(rs.lat, rs.lon);
const t = { kappa: Array.from(kappa), sightM: Array.from(Core.sightDistanceM(rs.lat, rs.lon)) };
const ch = P.character(Core, t);
console.log(JSON.stringify({ ch, line: P.characterLine(ch), none: P.characterLine([{ archetype: 'Fast open', startM: 0, endM: 9000 }]) }));
"""


def test_route_character():
    out = json.loads(subprocess.run([NODE, "-e", CHAR_RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    arches = [c["archetype"] for c in out["ch"]]
    assert len(arches) >= 3 and arches[0] == arches[-1] and arches[1] != arches[0], arches
    mid = out["ch"][1]
    assert 2500 <= mid["startM"] <= 3100 and 1000 <= mid["endM"] - mid["startM"] <= 2200
    assert out["line"].startswith(f"{mid['archetype']} ") and (" at 3." in out["line"] or " at 2." in out["line"]), out["line"]
    assert out["none"] == "", "plain road: nothing to say"


HAZ = r"""
const P = require(process.argv[1] + '/web/road_page.js');
// a straight road north, 2 km, at 5 m
const lat = [], lon = [];
for (let i = 0; i <= 400; i++) { lat.push(35 + i * 5 / 110540); lon.push(-83); }
const rs = { lat, lon };
const kx = 111320 * Math.cos(35 * Math.PI / 180);
const at = (m, off) => ({ lat: 35 + m / 110540, lon: -83 + off / kx });
const reports = [
  { kind: 'gravel', ...at(1200, 8), confirms: 3, clears: 0 },
  { kind: 'pothole', ...at(300, -12), confirms: 1, clears: 0 },
  { kind: 'debris', ...at(900, 90), confirms: 4, clears: 0 },       // off the road
  { kind: 'animal', ...at(600, 0), confirms: 1, clears: 3 },        // cleared
  { kind: 'debris', label: 'Oil', ...at(1500, 2), confirms: 0, clears: 0 },
];
const measured = { crowdBumps: [{ index: 80, p: 0.9 }, { index: 260, p: 0.85 }, { index: 9999, p: 0.9 }] };
const list = P.onThisRoad(rs, measured, reports);
const mi = (m) => `${(m / 1609.344).toFixed(1)} mi`;
console.log(JSON.stringify({ list, facts: P.hazardFacts(list, mi), none: P.hazardFacts(P.onThisRoad(rs, null, [])),
  unknown: P.onThisRoad(rs, null, null), unknownFacts: P.hazardFacts(null), bumpsOnly: P.hazardFacts(P.onThisRoad(rs, measured, null), mi),
  one: P.hazardFacts(P.onThisRoad(rs, { crowdBumps: [{ index: 80, p: 0.9 }] }, null), mi) }));
"""


@pytest.fixture(scope="module")
def haz():
    return json.loads(subprocess.run([NODE, "-e", HAZ, ROOT], capture_output=True, text=True, check=True).stdout)


def test_hazards_on_the_road_in_order(haz):
    kinds = [(x["kind"], x["atM"]) for x in haz["list"]]
    # off-road (90 m) and cleared reports are left out; the bump past the end too
    assert kinds == [("pothole", 300), ("bump", 400), ("gravel", 1200), ("bump", 1300), ("debris", 1500)]
    assert haz["list"][-1]["title"] == "Oil"


def test_hazard_lines(haz):
    f = haz["facts"]
    assert f[0] == ["2 bumps members felt", "at 0.2 and 0.8 mi"]
    assert ["Pothole", "at 0.2 mi · 1 confirmed"] in f
    assert ["Gravel", "at 0.7 mi · 3 confirmed"] in f
    assert ["Oil", "at 0.9 mi"] in f       # no confirmations: no count
    assert haz["one"] == [["Bump members felt", "at 0.2 mi"]]


def test_unknown_stays_unknown(haz):
    assert haz["unknown"] is None and haz["unknownFacts"] == []
    assert haz["none"] == [["On this road", "None reported"]]
    assert haz["bumpsOnly"] == [["2 bumps members felt", "at 0.2 and 0.8 mi"]]


ROUTE = r"""
const P = require(process.argv[1] + '/web/road_page.js');
// a route sampled every 10 m with its own dist
const lat = [], lon = [], dist = [];
for (let i = 0; i <= 2000; i++) { lat.push(35 + i * 10 / 110540); lon.push(-83); dist.push(i * 10); }
const kx = 111320 * Math.cos(35 * Math.PI / 180), at = (m, off) => ({ lat: 35 + m / 110540, lon: -83 + off / kx });
const reps = [{ kind: 'gravel', ...at(12000, 5), confirms: 3, clears: 0 }, { kind: 'pothole', ...at(3000, 0), confirms: 1, clears: 0 },
  { kind: 'closure', ...at(5000, 0), confirms: 2, clears: 0 }, { kind: 'debris', ...at(15000, 0), confirms: 1, clears: 0 },
  { kind: 'animal', ...at(16000, 0), confirms: 1, clears: 0 }, { kind: 'police', ...at(8000, 3000), confirms: 2, clears: 0 }];
const list = P.onThisRoad({ lat, lon, dist }, null, reps);
const km = (m) => `${(m / 1000).toFixed(0)} km`;
console.log(JSON.stringify({ at: list.map((x) => [x.kind, x.atM]), line: P.routeReportsLine(list, km), two: P.routeReportsLine(list, km, 2), none: P.routeReportsLine([], km) }));
"""


def test_route_reports_line():
    out = json.loads(subprocess.run([NODE, "-e", ROUTE, ROOT], capture_output=True, text=True, check=True).stdout)
    # metres from the route's own dist (10 m a sample here); the police report 3 km off it is left out
    assert out["at"] == [["pothole", 3000], ["closure", 5000], ["gravel", 12000], ["debris", 15000], ["animal", 16000]]
    # closures have their own warning
    assert out["line"] == "Reported on the way: Pothole at 3 km (1 confirmed) · Gravel at 12 km (3 confirmed) · Debris at 15 km (1 confirmed) and 1 more"
    assert out["two"].endswith("and 2 more") and out["none"] == ""
