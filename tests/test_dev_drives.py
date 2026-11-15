"""Developers' drives (web/dev_drives.js, backend/src/dev_drives.ts; the owner, 2026-11-15): a developer's phone uploads every
drive once, gzipped, stopping at the first failure; the file is lazy and loads only for a developer."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const D = require(process.argv[1] + '/web/dev_drives.js');
const zlib = require('zlib');
(async () => {
  const mem = {}, store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const drives = { a: { id: 'a', lat: [1, 2] }, b: { id: 'b', lat: [3] }, c: { id: 'c', lat: [4] } };
  const calls = []; let failOn = 'b';
  const deps = { ids: async () => Object.keys(drives), get: async (id) => drives[id], store, allowed: () => true,
    apiFetch: async (path, init) => { calls.push([path, init.method, init.headers['content-type'], JSON.parse(zlib.gunzipSync(Buffer.from(init.body)).toString())]);
      return { ok: !path.endsWith('/' + failOn) }; } };
  const first = await D.sync(deps);
  failOn = null;
  const second = await D.sync(deps);
  const third = await D.sync(deps);
  const off = await D.sync({ ...deps, allowed: () => false, ids: async () => ['z'] });
  console.log(JSON.stringify({ first, second, third, off, calls, sent: D.sentCount(store) }));
})();
"""


def run():
    out = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_uploads_each_drive_once_and_stops_at_a_failure():
    r = run()
    assert r["first"] == {"sent": 1, "total": 3, "pending": 2}       # a went up, b failed, c waits for the next sync
    assert r["second"] == {"sent": 2, "total": 3, "pending": 0}      # b and c; a is not sent again
    assert r["third"]["sent"] == 0
    assert [c[0] for c in r["calls"]] == ["/api/dev/drives/a", "/api/dev/drives/b", "/api/dev/drives/b", "/api/dev/drives/c"]
    assert all(c[1] == "POST" and c[2] == "application/gzip" for c in r["calls"])
    assert r["calls"][0][3] == {"id": "a", "lat": [1, 2]}             # the whole record, as the phone keeps it
    assert r["off"]["sent"] == 0 and r["sent"] == 3                   # not a developer (any more): nothing goes up


def test_only_a_developer_loads_it():
    lazy = open(os.path.join(ROOT, "web", "lazy.js"), encoding="utf-8").read()
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    cockpit = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "devdrives: ['dev_drives.js']" in lazy
    assert "dev_drives.js" not in html                                 # never on the launch path
    body = cockpit.split("function devDrivesSync() {", 1)[1].split("\n    }\n", 1)[0]
    assert body.lstrip().startswith("if (!devAccess")                   # gated on /api/me developer before anything loads
