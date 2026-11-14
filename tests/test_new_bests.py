"""Your best yet (web/drive_view.js newBests): the corners a drive beat every other pass of, by how much over your next
best (coach's prior_s, core/drive_analysis.py and its web/apex_core.js port). Over the grip ceiling, or inside the
alignment noise, is not a best."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const V = require(process.argv[1] + '/web/drive_view.js');
const m = (t, env = 0.8) => ({ time_s: t, envelope_use: env });
const co = { others: [{ date: 'Oct 3' }, { date: 'Nov 1' }], corners: [
  { m: m(5.0), best: null, best_from: -1, prior_s: 5.6, prior_from: 0 },      // 0.6 s up: a best
  { m: m(4.0), best: m(3.8), best_from: 1, prior_s: 3.8, prior_from: 1 },     // another pass quicker: not
  { m: m(6.0), best: null, best_from: -1, prior_s: 6.1, prior_from: 1 },      // 0.1 s: noise
  { m: m(3.0, 1.1), best: null, best_from: -1, prior_s: 4.0, prior_from: 0 }, // past the ceiling: not celebrated
  { m: m(7.0), best: null, best_from: -1, prior_s: null, prior_from: -1 },    // the only pass: nothing to beat
  { m: m(2.0), best: null, best_from: -1, prior_s: 2.3, prior_from: 1 },      // 0.3 s up
  { m: null, best: null, gain_s: null } ] };
console.log(JSON.stringify({ all: V.newBests(co), one: V.newBests(co, 1), none: V.newBests(null) }));
"""


def test_new_bests():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert [(x["k"], x["from"]) for x in out["all"]] == [(0, 0), (5, 1)]
    assert out["all"][0]["by_s"] == pytest.approx(0.6) and out["all"][1]["by_s"] == pytest.approx(0.3)
    assert [x["k"] for x in out["one"]] == [0] and out["none"] == []
