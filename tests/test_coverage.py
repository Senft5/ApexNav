"""Coverage map (web/coverage.js, IDEAS Q-14): a small box around the view, thicker lines the surer a road is (a confidence
level, never a count), [lon, lat] for the map."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/coverage.js');
const cache = new Map();
const first = C.add(cache, { ways: [{ way: 1, line: [[35.5, -83.5], [35.51, -83.5]], conf: [2, 0] }, { way: 2, line: [[35.6, -83.4], [35.6, -83.39]], conf: [2, 3] }, { way: 3, line: [[35.7, -83.4], [35.7, -83.39]], conf: [0, 1] }] });
const again = C.add(cache, { ways: [{ way: 1, line: [[35.5, -83.5], [35.51, -83.5]], conf: [2, 0] }] });
const more = C.add(cache, { ways: [{ way: 1, line: [[35.5, -83.5], [35.51, -83.5]], conf: [3, 0] }] });
console.log(JSON.stringify({
  far: C.boxFor({ s: 30, w: -90, n: 40, e: -80, zoom: 6 }),
  big: C.boxFor({ s: 35, w: -84, n: 36, e: -83, zoom: 9.5 }),
  small: C.boxFor({ s: 35.5, w: -83.6, n: 35.6, e: -83.5, zoom: 12 }),
  inside: [C.inside([35.52, -83.58, 35.58, -83.52], [[35.5, -83.6, 35.6, -83.5]]), C.inside([35.4, -83.6, 35.6, -83.5], [[35.5, -83.6, 35.6, -83.5]])],
  first, again, more, gj: C.geojson(cache),
  surface: [null, -1, 0, 0.05, 0.0999, 0.1, 0.16, 0.22, 0.2201, 0.6, NaN].map(C.surface),
  readings: {
    surer: C.reading({ conf: [1, 3], rough: [0.3, 0.08], banked: [null, 0.25], offCamber: [0.5, 0.02] }),
    tie: C.reading({ conf: [2, 2], rough: [0.1, 0.2], banked: [0.2, null], offCamber: [null, null] }),
    oneWay: C.reading({ conf: [0, 1], rough: [null, 0.3], banked: [null, null], offCamber: [null, null] }),
    old: C.reading({ conf: [2, 0] }),
    none: C.reading({ conf: [0, 0], rough: [null, null] }),
  },
  says: [
    C.describe({ conf: [1, 3], rough: [0.3, 0.071], banked: [null, 0.304], offCamber: [0.5, 0.02] }),
    C.describe({ conf: [1, 0], rough: [0.31, null], banked: [0.05, null], offCamber: [0.12, null] }),
    C.describe({ conf: [2, 0], rough: [0.15, null], banked: [null, null], offCamber: [null, null] }),
    C.describe({ conf: [2, 0] }),
    C.describe({ conf: [0, 0], rough: [null, null] }),
    C.describe(undefined),
  ],
  changed: (() => { const c = new Map(); C.add(c, { ways: [{ way: 9, line: [[1, 1], [1, 2]], conf: [2, 0], rough: [0.2, null] }] });
    return [C.add(c, { ways: [{ way: 9, line: [[1, 1], [1, 2]], conf: [2, 0], rough: [0.2, null] }] }), C.add(c, { ways: [{ way: 9, line: [[1, 1], [1, 2]], conf: [2, 0], rough: [0.3, null] }] }), C.geojson(c).features[0].properties]; })(),
  scale: [C.SMOOTH_G, C.ROUGH_G],
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_box_is_small_and_only_when_zoomed_in(out):
    assert out["far"] is None
    s, w, n, e = out["big"]
    assert n - s < 0.5 and e - w < 0.5 and abs((s + n) / 2 - 35.5) < 1e-3 and abs((w + e) / 2 + 83.5) < 1e-3
    assert out["small"] == [35.5, -83.6, 35.6, -83.5]
    assert out["inside"] == [True, False]


def test_lines_for_the_map(out):
    assert out["first"] is True and out["again"] is False and out["more"] is True
    f = out["gj"]["features"]
    assert [x["properties"]["t"] for x in f] == [2, 2, 0], "five or more passes strongest; a single pass faintest"
    assert all(set(x["properties"]) == {"t", "s", "way"} for x in f), "no pass counts on the map"
    assert [x["properties"]["s"] for x in f] == [0, 0, 0], "a way sent without roughness has no pavement class"
    assert f[0]["geometry"]["coordinates"][0] == [-83.5, 35.5]


def test_pavement_class_from_measured_roughness(out):
    """IDEAS U-13: smooth under 0.10 g, rough over 0.22 g, fair between; not measured is no class at all (never 'smooth')."""
    assert out["surface"] == [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 0]
    assert out["scale"] == [0.10, 0.22]


def test_the_scale_is_the_route_overviews():
    """One scale for "smooth" and "rough" in the app: the route overview's words (route_story.js) use the same two numbers."""
    with open(os.path.join(ROOT, "web", "route_story.js"), encoding="utf-8") as f:
        src = f.read()
    assert "r < 0.1) traits.push('smooth')" in src and "r > 0.22) traits.push('rough')" in src


def test_a_line_reads_its_surer_direction(out):
    r = out["readings"]
    assert r["surer"] == {"conf": 3, "rough": 0.08, "banked": 0.25, "offCamber": 0.02}
    assert r["tie"]["conf"] == 2 and abs(r["tie"]["rough"] - 0.15) < 1e-9 and r["tie"]["banked"] == 0.2 and r["tie"]["offCamber"] is None
    assert r["oneWay"] == {"conf": 1, "rough": 0.3, "banked": None, "offCamber": None}
    assert r["old"] == {"conf": 2, "rough": None, "banked": None, "offCamber": None}, "a server answer without roughness: unknown"
    assert r["none"] == {"conf": 0, "rough": None, "banked": None, "offCamber": None}


def test_a_tapped_road_in_words(out):
    assert out["says"] == [
        "Smooth pavement (0.07 g) · many passes · 30% of it banked",
        "Rough pavement (0.31 g) · one pass so far · 12% off-camber",
        "Fair pavement (0.15 g) · a few passes",
        "Measured · a few passes",
        "",
        "",
    ]
    assert not any(ch.isdigit() for ch in "".join(s.split("·")[1] for s in out["says"] if "·" in s)), "how sure is a level, never a count"


def test_new_roughness_redraws_the_line(out):
    same, rougher, props = out["changed"]
    assert same is False and rougher is True and props == {"t": 1, "s": 3, "way": 9}
