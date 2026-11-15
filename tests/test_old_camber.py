"""Camber from builds before the fix (camber v3, 2026-11-15) is unknown on the phone too, not only to the server.

The old live pipeline read the attitude filter's drift as camber (docs/notes/2026-11-15-camber-specific-force.md). On the
owner's 13 drives it called 75 of 245 corners banked or off-camber and moved Scores by up to 11 points through the corner
limit. A file without camber_v 3, or a record saved from one, keeps no camber: no corner reads banked from it, no limit
leans on it.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = Path(__file__).resolve().parents[1]

SCRIPT = r"""
const R = require('./web/recording.js'), Core = require('./web/apex_core.js');
// a straight, a 60 m radius left bend through 120 degrees, a straight; 5 m bins, 30 mph, the bend's lateral g
const pts = [];
let x = 0, y = 0, h = 0;
for (let i = 0; i < 260; i++) {
  const bend = i >= 100 && i < 100 + Math.round((120 * Math.PI / 180) * 60 / 5);
  if (bend) h += 5 / 60;
  x += 5 * Math.cos(h); y += 5 * Math.sin(h);
  pts.push({ lat: 35 + y / 110540, lon: -83 + x / (111320 * Math.cos(35 * Math.PI / 180)), lat_g: bend ? (13.41 ** 2 / 60) / 9.80665 : 0, bend });
}
const csv = (v) => ['distance_m,lat,lon,speed_mph,lon_g,lat_g,camber_deg' + (v ? ',camber_v' : ''),
  ...pts.map((p, i) => `${i * 5},${p.lat},${p.lon},30,0,${p.lat_g.toFixed(4)},${p.bend ? 6 : ''}` + (v ? `,${p.bend ? v : ''}` : ''))].join('\n');
const mods = (d) => d.events.filter((e) => e.type === 'corner').flatMap((e) => e.mods || []);
const apex = (d) => d.events.filter((e) => e.type === 'corner').map((e) => Math.round(e.apex_mph * 10) / 10);
const fixed = R.parse(Core, csv(3), 'a_20261116_100000.csv'), none = R.parse(Core, csv(0), 'b_20261116_100000.csv'), two = R.parse(Core, csv(2), 'c_20261116_100000.csv');
// a record an older build saved: its camber kept as recorded, its corners profiled with it
const saved = { ...fixed, id: 'rec_old', cam_v: 2 };
const repaired = R.repair(Core, saved);
const out = {
  fixed: { camV: fixed.cam_v, cams: fixed.camber.filter((v) => v != null).length, mods: mods(fixed), apex: apex(fixed) },
  none: { camV: none.cam_v, cams: none.camber.filter((v) => v != null).length, n: none.camber.length, mods: mods(none), apex: apex(none) },
  two: { camV: two.cam_v, cams: two.camber.filter((v) => v != null).length, mods: mods(two) },
  repaired: { cams: repaired.camber.filter((v) => v != null).length, mods: mods(repaired), apex: apex(repaired), again: R.repair(Core, repaired) === repaired },
  fixedUntouched: R.repair(Core, fixed) === fixed,
  scores: [R.scoreOf(Core, none).ds.score, R.scoreOf(Core, saved).ds.score],
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", SCRIPT], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_fixed_camber_is_kept_and_read(out):
    assert out["fixed"]["camV"] == 3 and out["fixed"]["cams"] > 20
    assert "banked" in out["fixed"]["mods"]                  # 6 degrees into the bend


def test_camber_from_an_older_build_is_unknown_when_parsed(out):
    for k in ("none", "two"):
        assert out[k]["camV"] is None and out[k]["cams"] == 0
        assert not {"banked", "off-camber"} & set(out[k]["mods"])
    assert out["none"]["n"] == 260                            # unknown (null) bin by bin, never dropped or zero
    assert out["none"]["apex"] and out["none"]["apex"] != out["fixed"]["apex"]   # the limit no longer leans on it


def test_a_saved_record_with_old_camber_is_profiled_again_without_it(out):
    r = out["repaired"]
    assert r["cams"] == 0 and not {"banked", "off-camber"} & set(r["mods"])
    assert r["apex"] == out["none"]["apex"]                  # as if it had never had camber
    assert r["again"]                                        # once: a repaired record is left as it is
    assert out["fixedUntouched"]                             # fixed camber is never touched
    assert out["scores"][0] == out["scores"][1]              # its Score is the camber-free one
