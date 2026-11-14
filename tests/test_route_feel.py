"""Members' road feel kept with a saved route (web/route_feel.js, IDEAS F-03): only the curvature runs blendCurvature would
take, by metres along the route so a rebuilt track lines up, the bumps and the coverage numbers; capped; gone with the route."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const F = require(process.argv[1] + '/web/route_feel.js');
const Core = require(process.argv[1] + '/web/apex_core.js');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const n = 100, dist = Array.from({ length: n }, (_, i) => i * 5), K = new Array(n).fill(null), N = new Array(n).fill(null);
for (let i = 10; i < 30; i++) { K[i] = 0.0123456 + i * 1e-4; N[i] = 3; }    // a 100 m run, 3 passes: kept
for (let i = 40; i < 44; i++) { K[i] = 0.02; N[i] = 4; }                     // 20 m: too short for blendCurvature, dropped
for (let i = 60; i < 80; i++) { K[i] = 0.03; N[i] = 1; }                     // one pass: dropped
const m = { km: 0.5, coveredKm: 0.1, coverage: 0.2, roughness: 0.123456, bankedKm: 0, avgPasses: 2.5, crowdK: K, crowdKn: N,
            crowdBumps: [{ index: 50, p: 3 }, { index: 999, p: 2 }], repavedOn: '2026-09' };
const S = mem(), t0 = Date.parse('2026-11-14T12:00:00Z');
const saved = F.save(S, 'r1', m, dist, t0);
const back = F.load(S, 'r1', dist.map((d) => d + 1));                          // a rebuilt track, a metre off
const kap = Array.from({ length: n }, () => 0.001);
const direct = Core.blendCurvature(kap, K, N), kept = Core.blendCurvature(kap, back.crowdK, back.crowdKn);
const short = F.load(S, 'r1', dist.slice(0, 20));                              // a track shorter than the copy
for (let i = 0; i < 25; i++) F.save(S, 'x' + i, m, dist, t0 + i + 1);
const capped = Object.keys(JSON.parse(S.getItem(F.KEY))).length, firstGone = F.load(S, 'r1', dist) === null;
F.save(S, 'gone', m, dist, t0 + 100); const removed = F.remove(S, 'gone') && F.load(S, 'gone', dist) === null;
const bigK = Array.from({ length: 100000 }, () => 0.0123456), bigN = bigK.map(() => 2), bigD = bigK.map((_, i) => i * 5);
const tooBig = F.save(mem(), 'big', { ...m, crowdK: bigK, crowdKn: bigN, crowdBumps: [] }, bigD, t0);
const junk = mem(); junk.setItem(F.KEY, '[1]');
console.log(JSON.stringify({ saved, keptAt: back.keptAt, sum: [back.km, back.coverage, back.roughness, back.avgPasses, back.located, back.repavedOn],
  replaced: [direct.replaced, kept.replaced], same: Array.from(direct.kappa).every((v, i) => Math.abs(v - kept.kappa[i]) < 1e-6),
  bumps: back.crowdBumps, short: [short.crowdK.length, short.crowdK.filter((v) => v != null).length], capped, firstGone, removed, tooBig,
  junk: F.load(junk, 'r1', dist), none: F.save(mem(), 'n', null, dist, t0), noId: F.save(mem(), '', m, dist, t0) }));
"""


def test_route_feel():
    r = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["saved"] is True and r["keptAt"] == 1794657600000, "kept with when it was asked"
    assert r["sum"] == [0.5, 0.2, 0.1235, 2.5, None, "2026-09"], "the coverage line's numbers; unknown stays unknown"
    assert r["replaced"] == [20, 20] and r["same"] is True, "the rebuilt route gets the same corners as with signal"
    assert r["bumps"] == [{"index": 50, "p": 3}], "a bump off the route is not kept"
    assert r["short"] == [20, 10], "a copy longer than the track is cut to it"
    assert r["capped"] == 20 and r["firstGone"] is True, "the newest twenty routes"
    assert r["removed"] is True and r["tooBig"] is False and r["junk"] is None
    assert r["none"] is False and r["noId"] is False
