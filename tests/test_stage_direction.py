"""Which way round a stage (IDEAS R-11): technical stages climbed, flowing ones descended, only when the DEM says the
stage really climbs and (for the crow-fly planner) the other end is close enough; unknown elevation changes nothing."""
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
globalThis.ApexCore = require(R + '/web/apex_core.js'); globalThis.ApexRouteLoading = require(R + '/web/route_loading.js');
require(R + '/web/stages.js'); const S = globalThis.ApexStages, F = require(R + '/web/fun_route.js');
// a 4 km stage running north from (35.5, -84.0)
const stage = (o) => ({ lat: Array.from({ length: 11 }, (_, i) => 35.5 + i * 0.0036), lon: Array(11).fill(-84.0), km: 4, score: 20, ...o });
const tech = stage({ tight: 8, elevA: 400, elevB: 650 }), flow = stage({ tight: 1, elevA: 400, elevB: 650 }), flat = stage({ tight: 8, elevA: 400, elevB: 420 }), unknown = stage({ tight: 8 });
const nearB = { lat: 35.53, lon: -84.0 }, farFromA = { lat: 35.62, lon: -84.0 };    // 0.7 km from b, 3.3 from a / 9 km past b
console.log(JSON.stringify({
  bonus: [F.directionBonus(tech, true), F.directionBonus(tech, false), F.directionBonus(flow, true), F.directionBonus(flow, false), F.directionBonus(flat, true), F.directionBonus(unknown, true)],
  dir: { techNearB: S.stageDirection(tech, nearB), flowNearB: S.stageDirection(flow, nearB), techFar: S.stageDirection(tech, farFromA), unknownNearB: S.stageDirection(unknown, nearB) },
  terrarium: [S.terrarium(128, 0, 0), S.terrarium(129, 44, 128)],
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_ranking_bonus(out):
    assert out["bonus"] == [3.0, 0, 0, 3.0, 0, 0]          # 15% of the score: technical climbed, flowing descended; flat or unknown, none


def test_crow_fly_direction(out):
    d = out["dir"]
    assert d["techNearB"] is True                           # climb it: start at a although b is nearer (2.6 km more, within the 3 km slack)
    assert d["flowNearB"] is False                          # descend it: start at b, which is also nearer
    assert d["techFar"] is False                            # starting at a would add 8 km of connector: the nearer end
    assert d["unknownNearB"] is False


def test_terrarium_decoding(out):
    assert out["terrarium"] == [0, 300.5]
