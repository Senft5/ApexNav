"""Our own Valhalla router (backend/src/valhalla.ts, router/, .github/workflows/valhalla-tiles.yml): the pieces that must
agree across files, and the app asking ours first with the public server as the stand-in (web/route_loading.js)."""
import json
import pathlib
import re
import shutil
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


def strip_jsonc(text: str) -> str:
    out, i, s = [], 0, False
    while i < len(text):
        c = text[i]
        if s:
            out.append(c)
            if c == "\\":
                out.append(text[i + 1]); i += 1
            elif c == '"':
                s = False
        elif c == '"':
            s = True; out.append(c)
        elif text.startswith("//", i):
            while i < len(text) and text[i] != "\n":
                i += 1
            continue
        else:
            out.append(c)
        i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


def test_region_file_is_built_from_the_outlines():
    r = subprocess.run([sys.executable, "-m", "tools.valhalla.region", "--check"], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_the_router_runs_the_image_that_built_its_tiles():
    docker = (ROOT / "router" / "Dockerfile").read_text()
    wf = (ROOT / ".github" / "workflows" / "valhalla-tiles.yml").read_text()
    frm = re.search(r"^FROM (\S+)$", docker, re.M).group(1)
    assert "@sha256:" in frm, "pin the Valhalla image by digest"
    assert f'IMAGE: "{frm}"' in wf


def test_tile_keys_agree_and_the_workflow_may_upload():
    store = (ROOT / "backend" / "src" / "data_store.ts").read_text()
    val = (ROOT / "backend" / "src" / "valhalla.ts").read_text()
    key = re.search(r"export const TILE_KEY = (/.+/);", val).group(1)
    assert key + "," in store, "data_store.ts KEYS must take exactly the keys the container reads"
    oidc = (ROOT / "backend" / "src" / "github_oidc.ts").read_text()
    assert '".github/workflows/valhalla-tiles.yml"' in oidc


def test_the_container_is_production_only():
    cfg = json.loads(strip_jsonc((ROOT / "wrangler.jsonc").read_text()))
    (c,) = cfg["containers"]
    assert c["class_name"] == "ValhallaRouter" and c["image"] == "./router/Dockerfile" and c["max_instances"] == 1
    assert {"name": "VALHALLA", "class_name": "ValhallaRouter"} in cfg["durable_objects"]["bindings"]
    assert any("ValhallaRouter" in m.get("new_sqlite_classes", []) for m in cfg["migrations"])
    prev = cfg["previews"]
    assert "containers" not in prev
    assert all(b["name"] != "VALHALLA" for b in prev["durable_objects"]["bindings"])


def test_index_lists_parts_in_order_with_the_tar_sha(tmp_path):
    sys.path.insert(0, str(ROOT))
    from tools.valhalla.index import index
    tar = tmp_path / "tiles.tar"
    tar.write_bytes(b"x" * 2500)
    parts = tmp_path / "parts"
    parts.mkdir()
    for i, chunk in enumerate([b"x" * 1000, b"x" * 1000, b"x" * 500]):
        (parts / f"part-{i:03d}").write_bytes(chunk)
    ix = index(str(tar), str(parts), "2026-46-abcd1234")
    import hashlib
    assert ix["parts"] == 3 and ix["bytes"] == 2500 and ix["sha256"] == hashlib.sha256(b"x" * 2500).hexdigest()
    (parts / "part-007").write_bytes(b"x")
    with pytest.raises(ValueError):
        index(str(tar), str(parts), "w")


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_app_asks_ours_first_and_the_public_server_when_ours_cant_answer():
    script = r"""
const assert = require('node:assert/strict');
const L = require(process.argv[1] + '/web/route_loading.js');
let asked = [], answer;
global.fetch = async (url, init) => { asked.push(url); return answer(url, init); };
const res = (status, body, headers = {}) => ({ ok: status === 200, status, headers: { get: (k) => headers[k] ?? null }, json: async () => body });
const pub = (url) => res(200, { trip: { via: 'public' } });
let t = 1000; const now = () => t;
(async () => {
  // no app around it (a test page, node): the public server only
  answer = pub; assert.deepEqual(await L.valhalla('route', { locations: [] }, 20000, now), { trip: { via: 'public' } });
  assert.deepEqual(asked, ['https://valhalla1.openstreetmap.de/route']);
  globalThis.ApexSync = { apiBase: 'https://vettadrive.app' }; globalThis.location = { protocol: 'apexnav:' };
  // ours answers
  asked = []; answer = (url) => url.startsWith('https://vettadrive.app/') ? res(200, { trip: { via: 'own' } }, { 'x-router': 'own' }) : pub(url);
  assert.deepEqual(await L.valhalla('route', '{}', 20000, now), { trip: { via: 'own' } });
  assert.equal(L.lastRouter, 'own'); assert.deepEqual(asked, ['https://vettadrive.app/api/valhalla/route']);
  // a 200 that isn't our router's (no x-router: own) is not taken
  asked = []; answer = (url) => url.startsWith('https://vettadrive.app/') ? res(200, { signed_in: false }) : pub(url);
  assert.deepEqual(await L.valhalla('route', '{}', 20000, now), { trip: { via: 'public' } });
  // outside the region: the public server, and ours is asked again next time
  asked = []; answer = (url) => url.startsWith('https://vettadrive.app/') ? res(503, { reason: 'outside_region' }) : pub(url);
  await L.valhalla('route', '{}', 20000, now); await L.valhalla('route', '{}', 20000, now);
  assert.equal(asked.filter((u) => u.includes('/api/valhalla/')).length, 2);
  // starting: the public server, and ours rests a minute
  asked = []; answer = (url) => url.startsWith('https://vettadrive.app/') ? res(503, { reason: 'starting' }) : pub(url);
  await L.valhalla('trace_route', '{}', 20000, now); await L.valhalla('trace_route', '{}', 20000, now);
  assert.deepEqual(asked, ['https://vettadrive.app/api/valhalla/trace_route', 'https://valhalla1.openstreetmap.de/trace_route', 'https://valhalla1.openstreetmap.de/trace_route']);
  t += 61000; asked = [];
  await L.valhalla('route', '{}', 20000, now);
  assert.equal(asked[0], 'https://vettadrive.app/api/valhalla/route');
  // ours unreachable: the public server
  L.resetValhallaForTest(); asked = []; answer = (url) => { if (url.startsWith('https://vettadrive.app/')) throw new TypeError('offline'); return pub(url); };
  assert.deepEqual(await L.valhalla('route', '{}', 20000, now), { trip: { via: 'public' } });
})().catch((e) => { console.error(e); process.exitCode = 1; });
"""
    r = subprocess.run([NODE, "-e", script, str(ROOT)], capture_output=True, text=True, timeout=20)
    assert r.returncode == 0, r.stderr


def test_cockpit_asks_valhalla_only_through_the_helper():
    js = (ROOT / "web" / "cockpit.js").read_text()
    assert "valhalla1.openstreetmap.de" not in js
    assert js.count("valhallaJson('") >= 4
