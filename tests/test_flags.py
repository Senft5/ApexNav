"""Feature flags on the phone (web/flags.js, IDEAS Y-06): the server's answer is used and cached; offline, unlisted or
before any answer, features keep their shipped default."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const m = new Map();
globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
const F = require(process.argv[1] + '/web/flags.js');
(async () => {
  const before = F.on('track_mode');
  const asked = [];
  await F.load(async (p) => { asked.push(p); return { ok: true, json: async () => ({ flags: { track_mode: false, half: true } }) }; }, 1000);
  const after = [F.on('track_mode'), F.on('half'), F.on('unlisted')];
  await F.load(async () => { throw new Error('should be cached'); }, 2000);
  await F.load(async () => { throw new Error('offline'); }, 1000 + F.TTL_MS + 1);
  console.log(JSON.stringify({ before, after, stillOff: F.on('track_mode'), asked, id: F.installId(), same: F.installId() === F.installId(), cached: !!m.get('apex.flags') }));
})();
"""


def test_flags():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["before"] is True, "no answer yet: the shipped default"
    assert out["after"] == [False, True, True]
    assert out["stillOff"] is False, "offline later: the last answer stands"
    assert out["asked"][0].startswith("/api/flags?install=i") and out["same"] and out["cached"]
