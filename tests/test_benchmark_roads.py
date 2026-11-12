"""Benchmark roads (IDEAS R-32 / Q-19): famous driving roads, scored from the saved map pieces of their region with the stage
scorer the app uses (stages.js strokes + bestWindow, no network), must rank as high as tests/benchmarks.js says. A stage
counts as the road when 60% of it lies within 60 m of the road's own named line in the map tiles (its points and the
segments between them)."""
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
global.ApexCore = require(R + '/web/apex_core.js');
global.ApexRouteLoading = { yieldToUI: async () => {} };
require(R + '/web/stages.js');
const S = global.ApexStages, { BENCHMARKS } = require(R + '/tests/benchmarks.js');
const m = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
const out = BENCHMARKS.map((b) => {
  const fx = JSON.parse(fs.readFileSync(`${R}/tests/fixtures/benchmarks/${b.id}.json`, 'utf8'));
  const pieces = fx.pieces.map((p) => ({ cls: p.c, pts: p.p }));
  const { strokes, ends } = S.strokes(pieces);
  const stages = strokes.map((s) => S.bestWindow(s, ends, pieces)).filter(Boolean).sort((x, y) => y.score - x.score);
  // the named line: its points (every ~100 m) and the segments between consecutive ones of the same line (<= 150 m apart;
  // further is a jump to another piece of it), so a stage between two points still counts as on it
  const segD = (p, a, b) => { const kx = 111320 * Math.cos(p[0] * Math.PI / 180), ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * 110540, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * 110540;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
  const segs = []; for (let i = 1; i < fx.on.length; i++) if (m(fx.on[i - 1], fx.on[i]) <= 150) segs.push([fx.on[i - 1], fx.on[i]]);
  const near = (p) => fx.on.some((o) => m(o, p) <= 60) || segs.some(([a, b]) => segD(p, a, b) <= 60);
  const onRoad = (st) => { let hits = 0, n = 0; for (let i = 0; i < st.lat.length; i += 10, n++) if (near([st.lat[i], st.lon[i]])) hits++; return hits / n >= 0.6; };
  const rank = stages.findIndex(onRoad) + 1;
  const hp = stages[rank - 1] ? (() => { const { kappa, ds } = global.ApexCore.computeCurvature(stages[rank - 1].lat, stages[rank - 1].lon); return global.ApexCore.detectCorners(kappa, ds).filter((c) => c.severity === 'HP').length; })() : 0;
  return { id: b.id, top: b.top, stages: stages.length, rank, on: fx.on.length, hairpins: hp };
});
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def results():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_every_benchmark_has_its_road_and_region(results):
    for r in results:
        assert r["on"] >= 50, f"{r['id']}: the road's named line wasn't found in the tiles"
        assert r["stages"] >= 10, f"{r['id']}: too few stages to rank against"
        assert r["rank"] >= 1, f"{r['id']}: no stage follows the road"


@pytest.mark.parametrize("road", ["tail_of_the_dragon", "big_sur", "stelvio", "route_33"])
def test_benchmark_ranks_high_enough(results, road):
    r = next(x for x in results if x["id"] == road)
    assert r["rank"] <= max(1, round(r["top"] * r["stages"])), f"{road}: #{r['rank']} of {r['stages']} (needs the top {round(r['top'] * 100)}%)"


def test_stelvio_east_ramp_hairpins_are_found(results):
    """A map line draws each Stelvio hairpin with a few vertices metres apart (radius 5-6 m), which the corner detector
    used to drop as GPS jitter (under 8 m): a hairpin-sized turn is now kept as a hairpin (IDEAS R-32). The east ramp's
    stage holds most of its hairpins (34 in the stroke; was 0)."""
    r = next(x for x in results if x["id"] == "stelvio")
    assert r["hairpins"] >= 25, r
