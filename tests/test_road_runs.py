"""Whole roads of a drive as stages (web/road_runs.js, the owner's note 09) and the route map (web/route_thumb.js, notes 09-10)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = require(process.argv[1] + '/web/road_runs.js'), T = require(process.argv[1] + '/web/route_thumb.js');
const fill = (name, k) => new Array(k).fill(name);
// Main St 30 (too short), Bank Road 100 with a 5-sample crossing of Elm and 4 unknown, Hill Rd 60, unknown tail
const names = [...fill('Main St', 30), ...fill('Bank Road', 50), ...fill('Elm', 5), ...fill('Bank Road', 30), ...fill(null, 4), ...fill('bank road', 20), ...fill('Hill Rd', 60), ...fill(null, 10)];
const runs = R.runs(names);
const elev = names.map((_, i) => i * 0.5);                       // climbing all the way
const n = 600, lat = Array.from({ length: n }, (_, i) => 39.1 + i * 1e-4), lon = Array.from({ length: n }, (_, i) => -84.6 + Math.sin(i / 50) * 1e-3);
const fake = async (d) => d.lat.map((_, k) => (k < 100 ? { way: 1, name: 'Bank Road' } : null));
(async () => {
  const fetched = await R.fetchNames({ lat, lon }, fake, null, 200);
  const svg = T.svg(lat, lon, { range: [100, 300], label: 'A <map>' }), plain = T.svg(lat, lon, {});
  console.log(JSON.stringify({ runs, labels: runs.map((r) => R.label(r, elev)), flat: R.label(runs[0], null), down: R.label(runs[0], elev.map((z) => -z)),
    sentFirst: fetched.findIndex((x) => x), sentLast: fetched.lastIndexOf('Bank Road'), len: fetched.length,
    tooShort: (await R.fetchNames({ lat: lat.slice(0, 300), lon: lon.slice(0, 300) }, fake, null, 200)).every((x) => x === null),
    ellipse: (svg.match(/<ellipse/g) || []).length, plainEllipse: (plain.match(/<ellipse/g) || []).length, escaped: svg.includes('A &lt;map&gt;'),
    none: T.svg([1], [2], {}), nan: !/NaN/.test(svg) }));
})();
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_a_road_is_whole_from_joining_to_leaving(out):
    # Bank Road runs through the Elm crossing and the unknown gap, case-insensitively; Main St is under 200 m
    assert [(r["name"], r["a"], r["b"]) for r in out["runs"]] == [("Bank Road", 30, 138), ("Hill Rd", 139, 198)]
    assert out["runs"][0]["length_m"] == 108 * 5


def test_label_says_uphill_or_downhill_only_when_heights_are_known(out):
    assert out["labels"] == ["Bank Road uphill", "Hill Rd uphill"]
    assert out["flat"] == "Bank Road"
    assert out["down"] == "Bank Road downhill"


def test_first_and_last_km_are_never_sent(out):
    assert out["len"] == 600 and out["sentFirst"] == 200 and out["sentLast"] == 299
    assert out["tooShort"]


def test_route_map_circles_the_stage(out):
    assert out["ellipse"] == 1 and out["plainEllipse"] == 0
    assert out["escaped"] and out["nan"] and out["none"] is None
