"""The call lockup in the notes strip (web/instruments.js lockup, docs/design/REVIEW.md roadmap 3): the call big, its
modifiers and caution one size down, so a long call never wraps to four lines."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const I = require(process.argv[1] + '/web/instruments.js');
const cases = [
  ['Left 4 plus long tightens, care', ['long', 'tightens']],
  ['Right 3 minus', []],
  ['Left hairpin over crest', ['over crest']],
  ['Square left off-camber, caution', ['off-camber']],
  ['Ease left, keep it gentle', []],
  ['A left that tightens', []],
  ['', ['long']],
];
console.log(JSON.stringify(cases.map(([c, m]) => I.lockup(c, m))));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_splits_the_call_from_its_modifiers(out):
    assert out[0] == {"head": "Left 4 plus", "tail": [{"text": "long", "warn": False}, {"text": "tightens", "warn": True},
                                                       {"text": "care", "warn": True}]}
    assert out[1] == {"head": "Right 3 minus", "tail": []}
    assert out[2] == {"head": "Left hairpin", "tail": [{"text": "over crest", "warn": True}]}
    assert out[3] == {"head": "Square left", "tail": [{"text": "off-camber", "warn": True}, {"text": "caution", "warn": True}]}


def test_plain_words_and_odd_input_stay_whole(out):
    assert out[4] == {"head": "Ease left", "tail": [{"text": "keep it gentle", "warn": True}]}   # a caution after a comma
    assert out[5] == {"head": "A left that tightens", "tail": []}                                 # no modifiers listed: whole
    assert out[6] == {"head": "", "tail": []}
