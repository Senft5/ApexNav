"""Avoid police reports (IDEAS R-35, the owner 2026-11-11): which reports a trip keeps away from (web/hazard_reports.js
policeFor), whether a route passes one (passesNear), and the avoid option's word on a route that couldn't (fun_route.js
unavoided). Never a checkpoint: there is no such kind (docs/APP_REVIEW.md 1.4.3)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const H = require(process.argv[1] + '/web/hazard_reports.js');
globalThis.ApexHazardReports = H;
const F = require(process.argv[1] + '/web/fun_route.js');
const now = Date.parse('2026-11-11T01:00:00Z');
const trip = [{ lat: 39.10, lon: -84.60 }, { lat: 39.20, lon: -84.50 }];
const list = [
  { id: 'p1', kind: 'police', lat: 39.15, lon: -84.55, confirms: 1, clears: 0, expires_at: '2026-11-11 01:30:00' },
  { id: 'old', kind: 'police', lat: 39.16, lon: -84.56, confirms: 0, clears: 0, expires_at: '2026-11-11 00:59:00' },
  { id: 'cleared', kind: 'police', lat: 39.12, lon: -84.58, confirms: 0, clears: 2, expires_at: '2026-11-11 01:40:00' },
  { id: 'far', kind: 'police', lat: 40.5, lon: -84.55, confirms: 3, clears: 0, expires_at: '2026-11-11 01:40:00' },
  { id: 'gravel', kind: 'gravel', lat: 39.14, lon: -84.54, confirms: 3, clears: 0, expires_at: '2026-11-11 05:00:00' },
  { id: 'dup', kind: 'police', lat: 39.1501, lon: -84.5501, confirms: 0, clears: 0, expires_at: '2026-11-11 01:20:00' },
];
const out = {};
out.pts = H.policeFor(list, trip, now);
out.withCall = H.policeFor(list, trip, now, [{ lat: 39.18, lon: -84.52 }]);
out.none = H.policeFor([], trip, now);
const by = [[-84.60, 39.10], [-84.55, 39.15], [-84.50, 39.20]];        // [lon, lat], through the report
const round = [[-84.60, 39.10], [-84.60, 39.20], [-84.50, 39.20]];     // the other way round, 4 km off it
out.passBy = H.passesNear(by, out.pts);
out.passRound = H.passesNear(round, out.pts);
const avoid = { ...F.AVOID_DEFAULT, police: true, points: out.pts };
const cands = [{ route: { coords: by, has: {} }, timeS: 600 }, { route: { coords: round, has: {} }, timeS: 700 }];
out.kept = F.keepAvoiding(cands, avoid).map((c) => c.timeS);
out.unavoided = F.unavoided(avoid, cands[0].route);
out.later = F.unavoided({ ...F.AVOID_DEFAULT, police: true }, cands[0].route);       // the card, later: kept on the route
out.off = F.unavoided({ ...F.AVOID_DEFAULT, points: out.pts }, cands[0].route);
out.label = F.AVOID_LABELS.police;
out.kinds = H.KINDS;
console.log(JSON.stringify(out));
"""


def run():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_live_police_reports_near_the_trip_only():
    r = run()
    # the live one; not the expired, the cleared, the far one, a gravel report or a second report on the same spot
    assert r["pts"] == [{"lat": 39.15, "lon": -84.55}], r["pts"]
    assert r["withCall"][0] == {"lat": 39.18, "lon": -84.52} and len(r["withCall"]) == 2, r["withCall"]
    assert r["none"] == []


def test_a_route_by_a_report_gives_way_to_one_round_it_and_says_so_when_none_can():
    r = run()
    assert r["passBy"] is True and r["passRound"] is False
    assert r["kept"] == [700]
    assert r["unavoided"] == ["police"] and r["later"] == ["police"] and r["off"] == []
    assert r["label"] == "police reports"


def test_no_checkpoint_kind():
    """App Store 1.4.3: DUI checkpoints only as published by the police. Vetta has no checkpoint report at all."""
    r = run()
    assert not any("check" in k or "dui" in k.lower() for k in r["kinds"]), r["kinds"]
    src = open(os.path.join(ROOT, "backend", "src", "hazards.ts")).read()
    assert "checkpoint" not in src.lower() and "dui" not in src.lower()
