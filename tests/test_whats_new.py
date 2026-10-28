"""What's new after an update (web/whats_new.js, IDEAS O-10): once per release, never on a first install or while busy,
one screen of at most four short lines."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const W = require(process.argv[1] + '/web/whats_new.js');
const id = W.NEWS.id;
const has = (x) => !!x;
console.log(JSON.stringify({
  update: has(W.pending('older', true, false)), never: has(W.pending(null, true, false)),
  again: has(W.pending(id, true, false)), firstInstall: has(W.pending(null, false, false)), busy: has(W.pending('older', true, true)),
  empty: has(W.pending('older', true, false, { id: 'x', items: [] })), items: W.NEWS.items,
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_when_it_shows(out):
    assert out["update"] and out["never"]
    assert not out["again"] and not out["firstInstall"] and not out["busy"] and not out["empty"]


def test_one_screen(out):
    assert 1 <= len(out["items"]) <= 4
    for title, text in out["items"]:
        assert len(title) <= 20 and len(text) <= 140, title
        for banned in ("faster", "speed", "race"):
            assert banned not in text.lower()
