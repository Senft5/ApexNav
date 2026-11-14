"""People you may know (web/people_suggest.js, docs/SOCIAL.md 2.14): why each person is suggested, and what this phone hid."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const S = require(process.argv[1] + '/web/people_suggest.js');
const list = [{ handle: 'erin', crew: 'Ridge Runners', mutual: 1 }, { handle: 'dave', crew: null, mutual: 2 }, { handle: 'fay', crew: null, mutual: 1 }, null, { crew: 'x' }];
console.log(JSON.stringify({
  reasons: list.slice(0, 3).map(S.reason),
  shown: S.shown(list, ['dave']).map((s) => s.handle),
  max: S.shown(list, [], 1).length,
  bad: [S.shown(null, null), S.shown('x', 'y')],
}));
"""


def test_reasons_and_hidden():
    r = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["reasons"] == ["In Ridge Runners", "2 friends in common", "1 friend in common"]
    assert r["shown"] == ["erin", "fay"]          # dave hidden on this phone; broken rows dropped
    assert r["max"] == 1
    assert r["bad"] == [[], []]
