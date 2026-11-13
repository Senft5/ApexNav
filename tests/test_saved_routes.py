"""Routes saved for offline (web/saved_routes.js, IDEAS F-03): what's kept, limits by distance on a rebuilt track,
newest first within the count and size caps, and remove."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const S = require(process.argv[1] + '/web/saved_routes.js');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const n = 401, dist = Array.from({ length: n }, (_, i) => i * 5);
const t = { id: 'r1', name: 'Cherohala loop', lat: dist.map((d) => 35.3 + d / 110540), lon: dist.map(() => -84.1234567891), dist,
  steps: [{ m: 600, type: 15, street: 'A', exits: null }], timeMarks: [[0, 0], [2000, 120]], fun: { fun: 7.2 }, timeS: 140,
  limitMps: dist.map((d) => (d < 500 ? 15.6464 : d < 1500 ? null : 24.5872)), request: { to: { lat: 1, lon: 2 }, via: [] }, unavoided: ['tolls'], townKm: 0.4 };
const p = S.pack(t, 1000);
const out = { coords0: p.coords[0], limits: p.limits, miles: p.miles, steps: p.steps, size: JSON.stringify(p).length };
// rebuilt on a slightly different spacing: limits follow distance
const dist2 = Array.from({ length: 300 }, (_, i) => i * 6.7);
const u = S.unpack(p, dist2);
out.atDist = [0, 74, 75, 223, 224, 299].map((i) => [Math.round(dist2[i]), u.limitMps[i]]);
out.kept = { steps: u.steps.length, timeMarks: u.timeMarks.length, timeS: u.timeS, fun: u.fun, unavoided: u.unavoided, townKm: u.townKm };
out.noLimits = S.unpack({ ...p, limits: null }, dist2).limitMps;
// road marks (road_marks.js) kept by distance, back on the rebuilt track's distances; none kept: undefined (the map is asked)
const pm = S.pack({ ...t, marks: [{ type: 'mark', kind: 'stop', code: 'STOP', call: 'Stop sign', index: 100, dist_m: 500, lat: 35.30452345, lon: -84.12345678 },
  { type: 'mark', kind: 'level_crossing', code: 'RAIL', call: 'Railway crossing', index: 300, dist_m: 1500, lat: 35.31, lon: -84.12 }] }, 1000);
out.marksPacked = pm.marks;
out.marksBack = S.unpack(pm, dist2).marks.map((m) => [m.type, m.code, m.call, m.index, Math.round(m.dist_m)]);
out.marksNone = [S.unpack(p, dist2).marks === undefined, S.pack({ ...t, marks: [] }).marks === undefined, S.unpack({ ...pm, marks: [{ m: 99999, call: 'x' }] }, dist2).marks === undefined];
const st = mem();
for (let i = 0; i < S.MAX + 3; i++) S.save(st, { ...p, id: 'r' + i, name: 'R' + i });
out.count = S.list(st).length; out.newest = S.list(st)[0].id; out.oldestKept = S.list(st).at(-1).id;
S.save(st, { ...p, id: 'r5', name: 'again' }); out.resaved = [S.list(st)[0].id, S.list(st).filter((x) => x.id === 'r5').length];
S.remove(st, 'r5'); out.removed = S.has(st, 'r5');
const broken = mem(); broken.setItem(S.KEY, '{not json'); out.broken = S.list(broken);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_pack_keeps_what_driving_needs(out):
    assert out["coords0"] == [-84.123457, 35.3]                       # 6 decimals (~10 cm)
    assert out["limits"] == [[0, 15.65], [500, None], [1500, 24.59]]  # change points, not 401 values
    assert out["miles"] == 1.2 and out["steps"][0]["street"] == "A"
    assert out["size"] < 20000


def test_limits_follow_distance_on_a_rebuilt_track(out):
    assert out["atDist"] == [[0, 15.65], [496, 15.65], [503, None], [1494, None], [1501, 24.59], [2003, 24.59]]
    assert out["kept"] == {"steps": 1, "timeMarks": 2, "timeS": 140, "fun": {"fun": 7.2}, "unavoided": ["tolls"], "townKm": 0.4}
    assert out.get("noLimits") is None


def test_list_caps_and_remove(out):
    assert out["count"] == 20 and out["newest"] == "r22" and out["oldestKept"] == "r3"
    assert out["resaved"] == ["r5", 1]
    assert out["removed"] is False
    assert out["broken"] == []


def test_road_marks_come_back_by_distance(out):
    assert out["marksPacked"][0] == {"kind": "stop", "code": "STOP", "call": "Stop sign", "m": 500, "lat": 35.304523, "lon": -84.123457}
    assert out["marksBack"] == [["mark", "STOP", "Stop sign", 75, 503], ["mark", "RAIL", "Railway crossing", 224, 1501]]
    assert out["marksNone"] == [True, True, True]
