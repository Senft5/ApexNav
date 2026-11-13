"""Your driving says one finding a skill: the mirror of a weakness ("stronger in tight corners") is not a second line."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")


def test_one_finding_a_skill_strongest_first():
    js = r"""
const P = require(process.argv[1] + '/web/driver_profile.js');
const f = (skill, split, a) => ({ skill, split, a, b: 'rest', mean_a: 40, mean_b: 90, drives: 3, agree: 3, also: [] });
const out = P.sayFindings([f('power', 'size', 'fast'), f('arc', 'side', 'right'), f('power', 'size', 'tight'), f('brakes', 'hill', 'down')]);
console.log(JSON.stringify([out.map((x) => x.skill + ':' + x.a), P.sayFindings(null)]));
"""
    root = str(Path(__file__).resolve().parents[1])
    kept, none = json.loads(subprocess.run([NODE, "-e", js, root], capture_output=True, text=True, check=True).stdout)
    assert kept == ["power:fast", "arc:right", "brakes:down"]
    assert none == []
