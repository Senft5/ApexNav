"""Corners from members' drives (index.html applyCrowdCurvature, IDEAS Q-04): a corner the map drew straight but the crowd
drove gets a note; too few passes or a short run changes nothing; it only runs once per route."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const fs = require('fs'), R = process.argv[1];
const Core = require(R + '/web/apex_core.js');
const html = fs.readFileSync(R + '/web/index.html', 'utf8');
const helper = html.match(/function cornerEventOf\(.*?\n    }/s)[0], apply = html.match(/function applyCrowdCurvature\(.*?\n    }/s)[0];
const fn = new Function('Core', 'MPH', 'window', helper + '; return (' + apply + ')')(Core, Core.MPS_TO_MPH, {});
const N = 400, mk = () => ({ kind: 'route', lat: Array.from({ length: N }, (_, i) => 35 + i * 5 / 110540), lon: Array(N).fill(-83),
  dist: Array.from({ length: N }, (_, i) => i * 5), kappa: Array(N).fill(0), sightM: Array(N).fill(300), envMps: Array(N).fill(30),
  events: [{ type: 'alpr', dist_m: 100 }] });
// the crowd drove a 40 m-radius bend from 500 m to 600 m that the map drew straight
const crowdK = Array(N).fill(null), crowdKn = Array(N).fill(null);
for (let i = 100; i < 120; i++) { crowdK[i] = 1 / 40; crowdKn[i] = 3; }
const t = mk(), changed = fn(t, { crowdK, crowdKn }), again = fn(t, { crowdK, crowdKn });
const thin = mk(), thinChanged = fn(thin, { crowdK, crowdKn: crowdKn.map((x) => (x ? 1 : null)) });
console.log(JSON.stringify({ changed, again, corrected: t.crowdCorrected, corners: t.events.filter((e) => e.type === 'corner').map((e) => [e.dir, Math.round(e.dist_m)]),
  kept: t.events.some((e) => e.type === 'alpr'), thinChanged, thinCorners: thin.events.filter((e) => e.type === 'corner').length }));
"""


def test_crowd_corners():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["changed"] is True and out["again"] is False and out["corrected"] == 100
    assert len(out["corners"]) == 1 and out["corners"][0][0] == "L" and 480 <= out["corners"][0][1] <= 620
    assert out["kept"] is True, "other notes (cameras) stay"
    assert out["thinChanged"] is False and out["thinCorners"] == 0, "one pass is not enough"
