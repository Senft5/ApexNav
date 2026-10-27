"""In the app, Where to? asks the shell's Apple place search through the bridge (web/index.html <-> ApexNavApp.swift)."""
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

SCRIPT = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('web/index.html', 'utf8');
const grab = (name) => { const m = html.match(new RegExp(`    (async )?function ${name}\\(.*?\\n    }`, 's')); assert.ok(m, name); return m[0]; };
const src = ['askNative', 'nativePlaceReply', 'appleSuggest', 'appleResolve'].map(grab).join('\n');
const sent = [];
let shell = null;                                   // the fake native side: answers like ApexNavApp.swift does
const window = { webkit: { messageHandlers: { apex: { postMessage: (m) => { sent.push(m); if (shell) setTimeout(() => shell(m), 5); } } } } };
const api = new Function('window', 'map', 'state', `const nativePlace = { waiting: new Map(), next: 1 }; ${src}; return { appleSuggest, appleResolve, nativePlaceReply };`)(
  window, { getCenter: () => ({ lat: 39.1, lng: -84.5 }) }, { lastPosition: { lat: 35.47, lon: -83.92 } });
(async () => {
  shell = (m) => {
    if (m.cmd === 'placeComplete') api.nativePlaceReply({ type: 'placeSuggestions', id: m.id, failed: false,
      items: [{ title: '123 Example Rd', subtitle: 'Robbinsville, NC' }, { title: 'Example Diner', subtitle: 'Robbinsville' }] });
    if (m.cmd === 'placeResolve') api.nativePlaceReply({ type: 'placeResolved', id: m.id, lat: 35.32, lon: -83.81 });
  };
  const rows = await api.appleSuggest('123 Example');
  assert.deepEqual(sent[0], { cmd: 'placeComplete', q: '123 Example', lat: 35.47, lon: -83.92, id: 1 });   // biased to the phone
  assert.deepEqual(rows.map((r) => [r.label, r.kind, r.apple.index]), [['123 Example Rd', 'Robbinsville, NC', 0], ['Example Diner', 'Robbinsville', 1]]);
  assert.deepEqual(await api.appleResolve(rows[0]), { lat: 35.32, lon: -83.81 });
  assert.deepEqual(sent[1], { cmd: 'placeResolve', index: 0, id: 2 });
  shell = (m) => api.nativePlaceReply({ type: 'placeSuggestions', id: m.id, failed: true, items: [] });
  assert.equal(await api.appleSuggest('zzz'), null);                                  // Apple failed: the caller uses Photon
  shell = null;                                                                       // no answer at all: give up after the timeout
  const t0 = Date.now(); assert.equal(await api.appleSuggest('slow'), null); assert.ok(Date.now() - t0 >= 3900);
})().catch((e) => { console.error(e); process.exitCode = 1; });
"""


def test_where_to_uses_the_shells_apple_search():
    root = Path(__file__).resolve().parents[1]
    p = subprocess.run([NODE, "-e", SCRIPT], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert p.returncode == 0, p.stderr
