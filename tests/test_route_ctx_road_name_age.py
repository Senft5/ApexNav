"""Old road or subdivision street from the name (web/route_ctx/road_name_age.js): a weak prior, validated on 1449 real
road names around Colerain Township, Cincinnati (tests/fixtures/route_ctx/road_names_cincinnati.json, OSM via OpenFreeMap
tiles). The truth is a proxy (through road of 2 km+ = old; short dead-end residential street = new), recorded honestly in
VALIDATION; this test recomputes the numbers so they can't drift from the code."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1], fs = require('fs');
globalThis.ApexCore = {};
require(R + '/web/stages.js');
const T = require(R + '/web/route_ctx/osm_tiles.js');
const A = require(R + '/web/route_ctx/road_name_age.js');
const { corridor } = require(R + '/tools/route_ctx_fixtures.js');
const rows = JSON.parse(fs.readFileSync(R + '/tests/fixtures/route_ctx/road_names_cincinnati.json', 'utf8')).rows.filter((r) => r.label);
const sc = (r) => A.score(r.name, r.cls).score;
const old = rows.filter((r) => r.label === 'old').map(sc), nw = rows.filter((r) => r.label === 'new').map(sc);
let w = 0; for (const a of old) for (const b of nw) w += a > b ? 1 : a === b ? 0.5 : 0;
const at = (t, label, sign) => { const p = rows.filter((r) => sign * sc(r) >= t); const hit = p.filter((r) => r.label === label).length;
  return { predicted: p.length, precision: hit / p.length, recall: hit / rows.filter((r) => r.label === label).length }; };
const out = { auc: w / old.length / nw.length, meanOld: old.reduce((a, b) => a + b, 0) / old.length, meanNew: nw.reduce((a, b) => a + b, 0) / nw.length,
  baseOld: old.length / rows.length, oldAt015: at(0.15, 'old', 1), oldAt040: at(0.4, 'old', 1), newAt040: at(0.4, 'new', -1), V: A.VALIDATION, C: A.CONFIDENCE };
out.scores = Object.fromEntries(['Old Colerain Road', 'Dry Ridge Road', 'Hamilton Cleves Pike', 'Fox Run Court', 'Willow Pointe Drive', 'Court Street', 'School House Road',
  'Olde Towne Way', 'Colerain Avenue', 'Muddy Creek Rd', ''].map((n) => { const s = A.score(n); return [n, s && s.score]; }));
out.bigWay = [A.score('Pebble Way').score, A.score('Pebble Way', 'tertiary').score];
(async () => {
  // the provider on a real route: names from the tiles, one span per named stretch with a cue
  const fx = JSON.parse(fs.readFileSync(R + '/tests/fixtures/route_ctx/indian_creek.json', 'utf8'));
  const c = corridor(fx.route); c.id = 'ic';
  const names = T.namesFrom(c, new Map(Object.entries(fx.tiles)));
  const r = A.aggregate(c, names, null);
  out.route = { status: r.status, spans: r.spans.map((s) => [s.kind, s.label]), nan: [...r.channels.name_age].filter((v) => !Number.isFinite(v)).length, n: c.lat.length };
  const none = A.aggregate(c, null, null);
  out.none = { status: none.status, allNaN: [...none.channels.name_age].every((v) => !Number.isFinite(v)) };
  // router edges win when they carry names
  const e = await A.provider.fetch([{ ...c, id: 'e', edges: [{ fromM: 0, toM: 1e6, name: 'Old Mill Road' }] }], {});
  out.edges = { status: e.e.status, v: e.e.channels.name_age[5] };
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True, timeout=60).stdout)


def test_validation_numbers_are_the_codes(out):
    v = out["V"]
    assert abs(out["auc"] - v["auc"]) < 0.01
    assert abs(out["meanOld"] - v["meanOld"]) < 0.01 and abs(out["meanNew"] - v["meanNew"]) < 0.01
    for k in ["oldAt015", "oldAt040", "newAt040"]:
        assert out[k]["predicted"] == v[k]["predicted"], k
        assert abs(out[k]["precision"] - v[k]["precision"]) < 0.01 and abs(out[k]["recall"] - v[k]["recall"]) < 0.01, k


def test_it_beats_chance_but_is_weighted_as_a_weak_prior(out):
    assert out["auc"] > 0.85
    assert out["oldAt015"]["precision"] > 5 * out["baseOld"], "an old-road cue is many times the base rate"
    assert out["oldAt015"]["precision"] < 0.8, "and still wrong often: a weak prior"
    assert out["C"]["weight"] <= 0.2
    assert "proxy" in out["V"]["truth"]


def test_names(out):
    s = out["scores"]
    assert s["Old Colerain Road"] == 1 and s["Hamilton Cleves Pike"] > 0.5 and s["Dry Ridge Road"] > 0.4 and s["Muddy Creek Rd"] > 0.4
    assert s["Fox Run Court"] < -0.5 and s["Willow Pointe Drive"] < -0.5 and s["Olde Towne Way"] < -0.5
    assert s["School House Road"] > 0.5 and abs(s["Court Street"]) < 0.4 and s["Colerain Avenue"] == 0
    assert s[""] is None, "no name is unknown, not neutral"
    assert out["bigWay"][1] > out["bigWay"][0], "subdivision cues count half on a bigger road"


def test_route(out):
    r = out["route"]
    assert r["status"] in ("ok", "partial") and r["nan"] < r["n"] * 0.1
    assert ["old_road_name", "Indian Creek Road"] in r["spans"]
    assert out["none"] == {"status": "unavailable", "allNaN": True}
    assert out["edges"]["status"] == "ok" and out["edges"]["v"] == 1
