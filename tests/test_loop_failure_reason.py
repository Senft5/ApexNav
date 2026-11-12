"""A loop our router fails to make is told apart from "no loop of that length" (Nate's "loop: none", 2026-11-12):
own_routing.loops keeps the worker's error in lastLoopError, cleared on every ask; the loop ask gets 20 s, not 8."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
globalThis.window = globalThis;
require(process.argv[1] + '/web/own_routing.js');
const R = globalThis.ApexOwnRouting;
(async () => {
  const route = { coords: [[-84.6, 39.1], [-84.5, 39.2], [-84.6, 39.15], [-84.6, 39.1]], timeS: 600, distM: 20000 };
  const timedOut = { covers: async () => true, loop: async () => { throw new Error('graph router timed out'); } };
  const empty = { covers: async () => true, loop: async () => ({ routes: [] }) };
  const some = { covers: async () => true, loop: async () => ({ routes: [{ route }] }) };
  const a = await R.loops(timedOut, { start: { lat: 39.1, lon: -84.6 }, km: 40 }); const errA = R.lastLoopError;
  const b = await R.loops(empty, { start: { lat: 39.1, lon: -84.6 }, km: 40 }); const errB = R.lastLoopError;
  const c = await R.loops(some, { start: { lat: 39.1, lon: -84.6 }, km: 40 }); const errC = R.lastLoopError;
  console.log(JSON.stringify({ a: a.length, errA, b: b.length, errB, c: c.length, errC }));
})();
"""


def test_a_failed_loop_ask_keeps_its_reason_and_an_empty_answer_does_not():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["a"] == 0 and out["errA"] == "graph router timed out"
    assert out["b"] == 0 and out["errB"] is None, "no loop found is not a failure"
    assert out["c"] == 1 and out["errC"] is None


def test_the_loop_ask_waits_20_s():
    src = open(os.path.join(ROOT, "web", "graph_router.js"), encoding="utf-8").read()
    assert "loop: (req) => ask({ type: 'loop', ...req }, 20000)" in src
