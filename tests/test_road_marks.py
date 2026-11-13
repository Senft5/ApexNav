"""Road marks on a planned route (web/road_marks.js): the route context's stop signs that apply, railway level crossings,
one-lane bridges and speed bumps become note events on the track, one per thing (mapped twice within 40 m is one; bumps
within 200 m of the last are one "Speed bumps" run); none without a context, none off the track."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1];
const O = require(R + '/web/route_ctx/osm_overpass.js'), M = require(R + '/web/road_marks.js'), Core = require(R + '/web/apex_core.js');
// a straight east-west road at 39 N, 2 km, the route context's 25 m samples
const n = 81, lat0 = 39, lon0 = -84.5, dLon = 25 / (111320 * Math.cos(39 * Math.PI / 180));
const c = { id: 's', lat: Float64Array.from({ length: n }, () => lat0), lon: Float64Array.from({ length: n }, (_, i) => lon0 + i * dLon), distM: Float64Array.from({ length: n }, (_, i) => i * 25) };
const at = (i, dyM = 0) => [lat0 + dyM / 110540, lon0 + i * dLon];
const way = (id, tags, pts, nodes) => ({ type: 'way', id, tags, nodes, geometry: pts.map(([la, lo]) => ({ lat: la, lon: lo })) });
const node = (id, [la, lo], tags) => ({ type: 'node', id, lat: la, lon: lo, tags });
const els = { elements: [
  way(1, { highway: 'tertiary', name: 'Ridge' }, [at(-1), at(10), at(20), at(30), at(31), at(32), at(33), at(50)], [100, 110, 120, 130, 131, 132, 133, 150]),
  way(9, { highway: 'tertiary', name: 'Ridge', bridge: 'yes', lanes: '1' }, [at(50), at(53)], [150, 153]),
  way(10, { highway: 'tertiary', name: 'Ridge' }, [at(53), at(81)], [153, 181]),
  way(2, { highway: 'primary', name: 'Pike' }, [at(10, -200), at(10), at(10, 200)], [210, 110, 211]),      // the route is the minor road: its stop applies
  way(3, { highway: 'residential', name: 'Lane' }, [at(20), at(20, 200)], [120, 220]),                      // a stop for Lane, not for the route
  node(110, at(10), { highway: 'stop' }), node(120, at(20), { highway: 'stop' }),
  node(130, at(30), { traffic_calming: 'hump' }), node(131, at(31), { traffic_calming: 'hump' }), node(132, at(32), { traffic_calming: 'table' }),
  node(133, at(33), { railway: 'level_crossing' }),
] };
const ctx = O.aggregate(c, O.parse(els), new Uint8Array(n).fill(1));
const t = { lat: Array.from(c.lat), lon: Array.from(c.lon), dist: Array.from(c.distM) };
const near = (a, b, la, lo) => Core.nearestIndex(a, b, la, lo, -1);
const ev = M.events(ctx, c, t, near);
const far = { lat: t.lat.map((v) => v + 0.01), lon: t.lon, dist: t.dist };          // a different road 1.1 km north
const chicane = M.marksOf({ points: [{ kind: 'calming', atM: 100, label: 'chicane' }, { kind: 'stop', atM: 300 }, { kind: 'stop', atM: 320 }, { kind: 'give_way', atM: 500 }, { kind: 'signal', atM: 600 }] });
console.log(JSON.stringify({ ev: ev.map((e) => ({ type: e.type, kind: e.kind, code: e.code, call: e.call, dist_m: e.dist_m })),
  far: M.events(ctx, c, far, near).length, none: M.events(null, c, t, near).length, noTrack: M.events(ctx, c, null, near).length, chicane,
  place: M.placeAt(c, 37.5), past: M.placeAt(c, 5000) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_marks_a_driver_needs_from_the_map(out):
    got = [(e["code"], e["call"], round(e["dist_m"])) for e in out["ev"]]
    assert got == [("STOP", "Stop sign", 250), ("HUMP", "Speed bumps", 750), ("RAIL", "Railway crossing", 825), ("BRIDGE", "One-lane bridge", 1275)]   # the span starts at its first sample matched to the bridge
    assert all(e["type"] == "mark" for e in out["ev"])


def test_nothing_invented_or_off_the_road(out):
    assert out["far"] == 0 and out["none"] == 0 and out["noTrack"] == 0
    # a chicane is no bump; a stop mapped twice is one; give-way and signals are not called
    assert out["chicane"] == [{"kind": "stop", "atM": 300, "n": 2}]
    assert out["place"][0] == pytest.approx(39) and out["past"] is None


def test_each_mark_has_its_own_glyph_on_the_strip():
    js = "const I = require(process.argv[1] + '/web/instruments.js'); console.log(JSON.stringify(['STOP', 'RAIL', 'BRIDGE', 'HUMP', 'XYZ'].map((c) => I.tulipSVG({ type: 'mark', code: c }, '#fff', '#f70'))));"
    svgs = json.loads(subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, check=True).stdout)
    assert "<polygon" in svgs[0] and "M58 32 L80 54" in svgs[1] and "M36 30" in svgs[2] and "Q50 34" in svgs[3]
    assert len(set(svgs[:4])) == 4 and all(s.count("#f70") == 0 for s in svgs[4:])   # an unknown code: the bare hazard straight
