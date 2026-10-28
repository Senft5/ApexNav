"""Route analysis in a Web Worker (IDEAS P-05): the worker and the inline fallback give the same answer, and a missing or
failing worker falls back to it."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1], fs = require('fs'), vm = require('vm');
const Core = require(R + '/web/apex_core.js');
// the worker file run in a sandbox that looks like a worker: importScripts, postMessage, onmessage
const posted = [];
const sandbox = { self: {}, Float64Array, Math, Array, Number, Object, Infinity, NaN, isFinite, String, JSON };
sandbox.self.postMessage = (m) => posted.push(m);
sandbox.importScripts = () => { sandbox.ApexCore = Core; };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + '/web/analysis_worker.js', 'utf8'), sandbox);
const lat = [], lon = [];
for (let i = 0; i < 3000; i++) { lat.push(35 + i * 5 / 110540); lon.push(-83 + 0.0008 * Math.sin(i / 25)); }
sandbox.self.onmessage({ data: { id: 7, lat: Float64Array.from(lat), lon: Float64Array.from(lon), offsets: null } });
const w = posted[0];
const client = require(R + '/web/analysis_client.js');
const inline = client.runInline(Core, lat, lon, null);
const same = (a, b) => JSON.stringify(Array.from(a)) === JSON.stringify(Array.from(b));
(async () => {
  // a worker that throws on start: the client falls back
  globalThis.Worker = function () { throw new Error('no workers here'); };
  const fb = await client.analyse(lat, lon, null, { Core });
  console.log(JSON.stringify({
    id: w.id, error: w.error || null, corners: w.corners.length,
    sameKappa: same(w.kappa, inline.kappa), sameSight: same(w.sight, inline.sight), sameEnv: same(w.env, inline.env),
    sameCorners: JSON.stringify(w.corners) === JSON.stringify(inline.corners),
    fallback: JSON.stringify(fb.corners) === JSON.stringify(inline.corners),
  }));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_worker_matches_inline(out):
    assert out["id"] == 7 and out["error"] is None and out["corners"] > 5
    assert out["sameKappa"] and out["sameSight"] and out["sameEnv"] and out["sameCorners"]


def test_no_worker_falls_back(out):
    assert out["fallback"] is True
