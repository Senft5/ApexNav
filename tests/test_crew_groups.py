"""Crews as groups (web/crew_page.js, 2026-11-16): the line under a crew's name that says which of your friends are in it."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/crew_page.js');
console.log(JSON.stringify([[], null, ['cara'], ['cara', null, 'sam'], ['cara', 'sam', 'jo'], ['cara', 'sam', 'jo', 'al']].map(C.knownLine)));
"""


def test_known_line():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60, check=True).stdout)
    assert out == [None, None, "cara is in it", "cara and sam are in it", "cara, sam and 1 friend are in it", "cara, sam and 2 friends are in it"]
