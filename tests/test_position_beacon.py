"""VI-1 (panel round 2): no position beacon. "Near me" lookups ask the server by a 0.1-degree cell, never from inside a
privacy zone or in a drive's first km, the phone filters and sorts, and the Worker keeps no request URLs."""
import json
import os
import pathlib
import re
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
NODE = shutil.which("node")

RUNNER = r"""
const Z = require(process.argv[1] + '/web/privacy_zones.js');
const out = {};
out.cell = Z.cell(35.96123, -83.92456);
out.cellNeg = Z.cell(-0.04, 0.05);
out.unknown = [Z.cell(NaN, 1), Z.cellQuery(NaN, 1, 20)];
out.query = [Z.cellQuery(35.96123, -83.92456, 20), Z.cellQuery(35.96123, -83.92456)];
const home = Z.add([], { lat: 35.96, lon: -83.92, r: 500, name: 'Home' }, 'h');
out.may = [
  Z.mayLookUp(home, 35.96, -83.92),                              // inside the zone, parked
  Z.mayLookUp(home, 35.98, -83.92),                              // outside, parked (no drive): fine
  Z.mayLookUp(home, 35.98, -83.92, 400, 1000),                   // outside, 400 m into a drive: not yet
  Z.mayLookUp(home, 35.98, -83.92, 1200, 1000),                  // past the edge
  Z.mayLookUp(home, 35.96, -83.92, 5000, 1000),                  // back home: never
  Z.mayLookUp(home, NaN, -83.92),
];
const rows = [{ id: 'far', lat: 36.2, lon: -83.92 }, { id: 'b', lat: 35.99, lon: -83.92 }, { id: 'a', lat: 35.981, lon: -83.92 }, { id: 'bad', lat: null, lon: 1 }];
out.near = Z.nearFirst(rows, 35.98, -83.92, 20).map((r) => [r.id, r.m]);
out.nearMeet = Z.nearFirst([{ id: 'm', meet_lat: 36.0, meet_lon: -83.92 }], 35.98, -83.92, 80, 'meet_lat', 'meet_lon').map((r) => r.id);
const c = Z.cellCache(120000);
c.set('35.9,-83.9', [1], 1000);
out.cache = [c.get('35.9,-83.9', 2000), c.get('35.9,-83.9', 125000) ?? null, c.get('36.0,-83.9', 2000) ?? null];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    if NODE is None:
        pytest.skip("node not installed")
    res = subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_cell_is_one_decimal(out):
    assert out["cell"] == {"lat": 36.0, "lon": -83.9, "key": "36.0,-83.9"}
    assert out["cellNeg"]["key"] in ("-0.0,0.1", "0.0,0.1")
    assert out["unknown"] == [None, ""]
    assert out["query"] == ["lat=36.0&lon=-83.9&km=20", "lat=36.0&lon=-83.9"]


def test_no_lookup_from_a_zone_or_before_the_edge(out):
    assert out["may"] == [False, True, False, True, False, False]


def test_phone_filters_and_sorts_by_its_own_distance(out):
    assert [r[0] for r in out["near"]] == ["a", "b"]
    assert out["near"][0][1] == 111                       # measured here, from the real point
    assert out["nearMeet"] == ["m"]


def test_cache_per_cell_for_two_minutes(out):
    assert out["cache"] == [[1], None, None]


# Every /api/* URL a page builds: no lat, lon or bbox written to more than one decimal place, so no request can carry a
# position finer than the cell. (Map-view boxes for /api/coverage are the map's view, not the phone's position, and
# don't use toFixed in the URL.)
API_LINE = re.compile(r"/api/[^'\"`\s]*\?")


def _api_lines():
    for p in sorted(list(WEB.glob("*.js")) + list(WEB.glob("*.html"))):
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if API_LINE.search(line):
                yield p.name, i, line


def test_no_api_url_carries_a_fine_coordinate():
    bad = []
    for name, i, line in _api_lines():
        if not re.search(r"(lat|lon|bbox)=", line):
            continue
        for n in re.findall(r"toFixed\((\d+)\)", line):
            if int(n) > 1:
                bad.append(f"{name}:{i}: toFixed({n})")
    assert not bad, "an /api/* URL carries a coordinate finer than 0.1 degree:\n" + "\n".join(bad)


def test_near_me_lookups_use_the_cell():
    cockpit = (WEB / "cockpit.js").read_text(encoding="utf-8")
    events = (WEB / "crew_events.js").read_text(encoding="utf-8")
    assert cockpit.count("/api/hazards?${ApexPrivacyZones.cellQuery(") == 5   # live reports, discovery, the drive, the road page, ahead
    ahead = cockpit[cockpit.index("async function askAhead"):]
    ahead = ahead[:ahead.index("\n    }\n")]
    assert "ApexPrivacyZones.routeCells(t.lat, t.lon, privacyZones, edgeM)" in ahead   # the route's cells: no ends, no zones
    assert "/api/crews/discover?${ApexPrivacyZones.cellQuery(" in cockpit
    assert "/api/events/near?${Z.cellQuery(" in events
    # the drive's own lookup: gated (zone, private edge) and cached per cell
    body = cockpit[cockpit.index("async function loadReported"):cockpit.index("// Viewpoints, cafés and fuel")]
    assert "nearLookupOk(p)" in body and "reported.cells.get(" in body and "nearFirst(" in body
    assert "ApexContributor.privateEdge()" in cockpit and "Math.max(1000," in cockpit
    assert "nearLookupOk(near)" in cockpit                                   # crews near you
    assert "page.mayLookUp && !page.mayLookUp(at)" in events                 # meets near you


def test_worker_keeps_no_request_urls():
    text = (ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
    blocks = re.findall(r'"observability":\s*(\{.*\})\s*,', text)
    assert len(blocks) == 2                                                  # production and previews
    for b in blocks:
        assert '"invocation_logs": false' in b and '"redact_query_string": true' in b


def test_server_snaps_to_the_cell():
    src = ROOT / "backend" / "src"
    assert "nearCell(url)" in (src / "hazards.ts").read_text(encoding="utf-8")
    assert "nearCell(url)" in (src / "events.ts").read_text(encoding="utf-8")
    assert "nearCell(url)" in (src / "social.ts").read_text(encoding="utf-8")
