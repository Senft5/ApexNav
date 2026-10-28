"""The website's offline shell (web/sw.js, IDEAS A-03): network first, the last copy offline, never /api or other hosts."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const store = new Map(), handlers = {};
let online = true, served = [];
const pathOf = (r) => new URL(typeof r === 'string' ? r : r.url, 'https://apexnav.app').pathname;
const caches = {
  open: async () => ({ put: async (req, res) => store.set(pathOf(req), res), addAll: async (list) => list.forEach((p) => store.set(p, { body: 'shell ' + p })) }),
  match: async (req, o) => store.get(pathOf(req)) || null,
  keys: async () => ['apexnav-shell-v0', 'apexnav-shell-v1', 'other'], delete: async (k) => { served.push('deleted ' + k); return true; },
};
const self = { location: { origin: 'https://apexnav.app' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => {}, clients: { claim: () => {} } };
globalThis.self = self; globalThis.caches = caches;
globalThis.fetch = async (req) => {
  if (!online) throw new Error('offline');
  if (typeof req === 'string') return { ok: true, text: async () => '<script src="apex_core.js"></script><script src="https://cdn.x/y.js"></script>' };   // install reads the pages
  served.push('net ' + new URL(req.url).pathname); return { ok: true, type: 'basic', body: 'fresh', clone() { return { body: 'fresh copy' }; } };
};
require(process.argv[1] + '/web/sw.js');
const run = async (url, mode = 'no-cors', method = 'GET') => {
  let p = null; handlers.fetch({ request: { url, mode, method }, respondWith: (x) => { p = x; } });
  if (!p) return 'passed through';
  try { return (await p).body; } catch (e) { return 'error'; }
};
(async () => {
  let w; handlers.install({ waitUntil: (x) => { w = x; } }); await w;
  handlers.activate({ waitUntil: (x) => { w = x; } }); await w;
  const out = { online: await run('https://apexnav.app/stages.js') };
  await new Promise((r) => setTimeout(r, 0));
  online = false;
  out.offlineCached = await run('https://apexnav.app/stages.js');
  out.offlinePage = await run('https://apexnav.app/index.html?drive=x', 'navigate');
  out.offlineUnknownPage = await run('https://apexnav.app/nowhere.html', 'navigate');
  out.offlineMiss = await run('https://apexnav.app/nothing.js');
  out.api = await run('https://apexnav.app/api/me');
  out.voices = await run('https://apexnav.app/voices/a.bin');
  out.other = await run('https://tiles.openfreemap.org/x.pbf');
  out.post = await run('https://apexnav.app/index.html', 'navigate', 'POST');
  out.g2p = await run('https://apexnav.app/g2p/en_us_lexicon.json');
  out.script = await run('https://apexnav.app/apex_core.js');                     // precached from the page's <script src>
  out.log = served;
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_network_first_then_the_last_copy(out):
    assert out["online"] == "fresh"
    assert out["offlineCached"] == "fresh copy"
    assert out["offlinePage"] == "shell /index.html"
    assert out["offlineUnknownPage"] == "shell /index.html"          # any page offline: the cockpit shell
    assert out["offlineMiss"] == "error"


def test_never_api_voices_other_hosts_or_writes(out):
    assert out["api"] == out["voices"] == out["other"] == out["post"] == out["g2p"] == "passed through"
    assert out["script"] == "shell /apex_core.js"


def test_old_shells_are_cleared(out):
    assert "deleted apexnav-shell-v0" in out["log"] and "deleted apexnav-shell-v1" in out["log"] and "deleted other" not in out["log"]
