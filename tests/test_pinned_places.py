"""Pinned places (web/pinned_places.js, IDEAS U-20): Home then Work then the rest; a name re-pinned replaces; bad ones refused."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/pinned_places.js');
const m = {}; const st = { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; } };
P.pin(st, 'Gym', { label: 'Planet', lat: 1, lon: 1 });
P.pin(st, 'Work', { label: 'Office', lat: 2, lon: 2 });
P.pin(st, 'home', { label: '12 Elm St', lat: 3, lon: 3 });
P.pin(st, 'Dragon', { label: 'Deals Gap', lat: 4, lon: 4 });
const order = P.list(st).map((p) => p.name);
P.pin(st, 'HOME', { label: '9 Oak Ave', lat: 5, lon: 5 });
const home = P.list(st).filter((p) => /home/i.test(p.name));
const bad = [P.pin(st, '  ', { lat: 1, lon: 1 }), P.pin(st, 'X', { lat: 200, lon: 1 }), P.pin(st, 'Y', null)];
P.unpin(st, 'gym');
console.log(JSON.stringify({ order, home, bad, after: P.list(st).map((p) => p.name) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_home_then_work_then_newest(out):
    assert out["order"] == ["home", "Work", "Dragon", "Gym"]


def test_repin_replaces_and_bad_refused(out):
    assert out["home"] == [{"name": "HOME", "label": "9 Oak Ave", "lat": 5, "lon": 5}]
    assert out["bad"] == [None, None, None]
    assert out["after"] == ["HOME", "Work", "Dragon"]
