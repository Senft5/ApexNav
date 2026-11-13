"""The corner overlay (web/corner_trace.js): one corner, this pass against another pass of it, lined up by
position on this drive's road. Two made-up passes of one road: the second brakes later and carries more speed."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const Core = require(process.argv[1] + '/web/apex_core.js'), T = require(process.argv[1] + '/web/corner_trace.js');
// a road of 5 m bins: 600 m straight north, a 90-degree right of 60 m radius, 300 m straight east
const pts = [];
let x = 0, y = 0, h = 0;
for (let s = 0; s <= 1300; s += 5) {
  pts.push([x, y]);
  const k = s >= 600 && s < 600 + Math.PI / 2 * 60 ? 1 / 60 : 0;
  h += k * 5; x += 5 * Math.sin(h); y += 5 * Math.cos(h);
}
const n = pts.length, apex = 127, start = 120, end = 139;
const drive = (vmin, brakeAt, shift) => {
  const v = pts.map((_, i) => (i < brakeAt ? 25 : i < apex ? 25 - (25 - vmin) * (i - brakeAt) / (apex - brakeAt) : Math.min(25, vmin + (i - apex) * 0.4)));
  const lon = v.map((_, i) => (i ? (v[i] * v[i] - v[i - 1] * v[i - 1]) / (2 * 5) / 9.80665 : 0));
  const lat = pts.map((_, i) => (i >= 120 && i <= 139 ? -(v[i] * v[i] / 60) / 9.80665 : 0));
  return { lat: pts.map((p) => 35 + (p[1] + shift) / 110540), lon: pts.map((p) => -83 + p[0] / (111320 * Math.cos(35 * Math.PI / 180))),
           dist: pts.map((_, i) => i * 5), speed_mps: v, lon_g: lon, lat_g: lat, corners: [{ start, end, apex, apex_mps: vmin }] };
};
const a = drive(12, 100, 0), b = drive(14, 108, 2);
const t = T.trace(Core, a, 0, b);
const rows = T.rows(t, { dist: (m) => `${Math.round(m)} m`, speed: (v) => `${Math.round(v * 2.23694)} mph` });
const far = { ...b, lat: b.lat.map((v) => v + 0.01) };
console.log(JSON.stringify({ t, rows, none: T.trace(Core, a, 0, far), noCorner: T.trace(Core, a, 5, b), empty: T.rows(null, {}) }));
"""


@pytest.fixture(scope="module")
def r():
    p = subprocess.run([NODE, "-e", RUNNER, os.getcwd()], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_the_two_passes_line_up_on_this_drive_road(r):
    t = r["t"]
    assert t["x_m"][0] < -150 and t["x_m"][-1] >= 60 and 0 in t["x_m"]
    k = t["x_m"].index(0)
    assert t["a_mps"][k] == pytest.approx(12) and t["b_mps"][k] == pytest.approx(14, abs=0.6)   # 2 m off the road: same place
    assert all(v is not None for v in t["b_mps"][5:-5])


def test_marks_say_where_each_pass_braked_and_was_slowest(r):
    a, b = r["t"]["a"], r["t"]["b"]
    assert a["brake_m"] > b["brake_m"] > 0, (a, b)        # this pass braked earlier, further before the middle
    assert a["min_mps"] == pytest.approx(12) and b["min_mps"] == pytest.approx(14)


def test_the_gap_builds_where_this_pass_is_slower(r):
    t = r["t"]
    assert t["corner_s"] > 0.1 and t["gap_s"][-1] > t["gap_s"][0]


def test_rows_are_labelled_this_pass_then_the_best(r):
    rows = r["rows"]
    assert rows[0].startswith("Braking: ") and " · best pass " in rows[0] and rows[0].endswith(" before the middle")
    assert any(x.startswith("Slowest: 27 mph") and "best pass 31 mph" in x for x in rows), rows
    assert rows[-1].startswith("Through the corner: ") and rows[-1].endswith(" s slower than the best pass")


def test_no_trace_where_the_other_drive_was_not(r):
    assert r["none"] is None and r["noCorner"] is None and r["empty"] == []
