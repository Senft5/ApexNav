"""Send feedback (web/feedback.js, IDEAS L-05): diagnostics are a fixed few, never a place; nothing empty is sent."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const F = require(process.argv[1] + '/web/feedback.js');
const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ApexNav/1.0 (384)';
const env = { ua, w: 390, h: 844, lang: 'en-US', errors: 2, online: false, page: '/index.html', lat: 35.6 };
console.log(JSON.stringify({
  diag: F.diagnostics(env), web: F.diagnostics({ ua: 'Mozilla/5.0 (Windows NT 10.0)' }),
  full: F.payload({ kind: 'idea', message: '  More hairpins  ', app: 'ios', attach: true, reply: true, env }),
  bare: F.payload({ kind: 'rant', message: 'x', app: 'android', attach: false, reply: false, env }),
  empty: F.payload({ kind: 'bug', message: '   ', app: 'ios', attach: true, env }),
  long: F.payload({ kind: 'bug', message: 'y'.repeat(5000), app: 'web' }).message.length,
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_diagnostics_are_a_fixed_few(out):
    assert out["diag"] == {"platform": "iPhone", "version": "1.0", "build": "384", "screen": "390x844", "lang": "en-US",
                           "page": "/index.html", "errors_today": 2, "offline": 1}
    assert out["web"] == {"platform": "Windows"}


def test_payload(out):
    assert out["full"] == {"kind": "idea", "message": "More hairpins", "app": "ios", "diag": out["diag"], "reply": True}
    assert out["bare"] == {"kind": "other", "message": "x", "app": "web"}
    assert out["empty"] is None
    assert out["long"] == 2000


def test_server_keeps_the_same_keys():
    src = open(os.path.join(ROOT, "backend", "src", "feedback.ts"), encoding="utf-8").read()
    for k in ["version", "build", "platform", "screen", "lang", "page", "errors_today", "offline"]:
        assert f'"{k}"' in src
