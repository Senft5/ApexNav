"""The DOTs' own traffic events on the phone (web/road_events.js, backend/src/traffic.ts): what is near you joins the
drivers' reports (web/hazard_reports.js) as `official`: called "ahead", not "reported ahead", plated with its road and
agency, never asked "still there?", and only full closures (both ways) are routed round."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = require(process.argv[1] + '/web/road_events.js');
const H = require(process.argv[1] + '/web/hazard_reports.js');
const N = (m) => m / 110540;
const now = Date.parse('2026-11-14T03:00:00Z');
const at = { lat: 39.0, lon: -85.0 };
const ev = (id, kind, mNorth, extra = {}) => ({ id, kind, label: kind === 'closure' ? 'Road closed' : kind === 'roadwork' ? 'Roadwork' : 'Lane closed', lat: at.lat + N(mNorth), lon: at.lon, road: 'IN 114', until: now + 3600e3, src: 'INDOT', ...extra });
const json = { events: [
  ev('dot:IN:1', 'closure', 400), ev('dot:IN:2', 'roadwork', 2500), ev('dot:IN:3', 'roadwork', 5000), ev('dot:IN:4', 'closure', 15000),
  ev('dot:IN:5', 'closure', 30000), ev('dot:IN:6', 'lane', 300, { heading: 180 }), ev('dot:IN:7', 'slow', 900, { until: now - 1 }),
  ev('dot:IN:8', 'mystery', 100), { id: 'dot:IN:9', kind: 'closure', lat: 'x', lon: 1 }, null, ev('dot:IN:10', 'closed_way', 600, { label: 'Closed northbound', heading: 0, until: null }),
] };
const out = {};
const rows = R.rows(json);
out.rows = rows.map((r) => r.id);
out.allOfficial = rows.every((r) => r.official === true);
out.near = R.near(rows, at.lat, at.lon, now).map((r) => [r.id, r.m]);
out.nearNone = R.near(rows, NaN, 0, now);
out.closures = R.closures(rows).map((r) => r.id);
out.due = [R.due(NaN, now), R.due(now - 60e3, now), R.due(now - 300e3, now)];
out.moved = [R.moved(null, at), R.moved(at, { lat: at.lat + N(500), lon: at.lon }), R.moved(at, { lat: at.lat + N(1200), lon: at.lon })];
const near = R.near(rows, at.lat, at.lon, now);
const me = { ...at, heading: 0 };
out.next = H.nextAhead(near, me, 600, new Set());
out.nextSouth = H.nextAhead(near, { ...at, lat: at.lat + N(1000), heading: 180 }, 900, new Set(['dot:IN:1']));   // the closure heard already
out.plate = H.plate(near[0], (m) => `${m} m`, now);
const w = H.createPassWatch(), seen = [];
for (const m of [0, 290, 300, 310, 400, 410, 500]) seen.push(w.update(near, { lat: at.lat + N(m), lon: at.lon, heading: 0 }, new Set())?.id ?? null);
out.asked = seen;
out.routed = H.closuresFor(near, [at, { lat: at.lat + N(2000), lon: at.lon }]);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_rows_keep_known_kinds_with_a_place(out):
    assert out["rows"] == ["dot:IN:1", "dot:IN:2", "dot:IN:3", "dot:IN:4", "dot:IN:5", "dot:IN:6", "dot:IN:7", "dot:IN:10"]
    assert out["allOfficial"]


def test_near_you_closures_far_roadwork_close_and_none_ended(out):
    # closures and the like within 20 km; roadwork and lane closures within 3 km (a city has dozens); an ended one left out
    assert out["near"] == [["dot:IN:6", 300], ["dot:IN:1", 400], ["dot:IN:10", 600], ["dot:IN:2", 2500], ["dot:IN:4", 15000]]
    assert out["nearNone"] == []


def test_only_full_closures_are_routed_round(out):
    assert out["closures"] == ["dot:IN:1", "dot:IN:4", "dot:IN:5"]
    # near you: the full closures inside the trip's box (widened 15 km), the lane closure and one-way closure never
    assert [round((p["lat"] - 39.0) * 110540) for p in out["routed"]] == [400, 15000]


def test_called_ahead_in_its_own_words_and_only_your_way(out):
    # the lane closure 300 m ahead is southbound only: heading north it isn't yours; the closure at 400 m is
    assert out["next"]["id"] == "dot:IN:1" and out["next"]["text"] == "Road closed ahead"
    assert out["nextSouth"]["id"] == "dot:IN:6" and out["nextSouth"]["text"] == "Lane closed ahead"


def test_plate_says_road_and_agency_never_an_age(out):
    assert out["plate"] == {"title": "Lane closed", "detail": "in 300 m · IN 114 · INDOT"}


def test_never_asked_still_there(out):
    assert out["asked"] == [None] * 7


def test_refresh_and_remerge(out):
    assert out["due"] == [True, False, True]
    assert out["moved"] == [True, False, True]
