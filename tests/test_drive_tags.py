"""Drive tags and notes (web/drive_tags.js, IDEAS D-23): cleaned, no repeats in any case, a cap; the Log's filter."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const T = require(process.argv[1] + '/web/drive_tags.js');
const drives = [{ tags: ['Wet', 'E46'] }, { tags: ['wet', 'Night'] }, { tags: null }, { tags: ['E46 ', 'Wet'] }];
console.log(JSON.stringify({
  norm: T.normalize(['  Wet  ', 'wet', '', null, 'A  very   long tag that goes on and on', 1, 2, 3, 4, 5, 6, 7]),
  on: T.toggle(['Wet'], 'Night'), off: T.toggle(['Wet', 'Night'], 'WET'), blank: T.toggle(['Wet'], '  '),
  used: T.used(drives), wetE46: drives.map((d) => T.matches(d, ['wet', 'E46'])), all: drives.map((d) => T.matches(d, [])),
  offered: T.offered(drives, ['Sam']), note: T.note('  x'.padEnd(400, 'y')).length,
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_normalize(out):
    assert out["norm"] == ["Wet", "A very long tag that goe", "1", "2", "3", "4", "5", "6"]


def test_toggle(out):
    assert out["on"] == ["Wet", "Night"]
    assert out["off"] == ["Night"]
    assert out["blank"] == ["Wet"]


def test_used_and_filter(out):
    assert out["used"] == [{"tag": "Wet", "count": 3}, {"tag": "E46", "count": 2}, {"tag": "Night", "count": 1}]
    assert out["wetE46"] == [True, False, False, True]
    assert out["all"] == [True, True, True, True]


def test_offered_and_note(out):
    assert out["offered"][:7] == ["Dry", "Wet", "Night", "Solo", "Passenger", "Felt good", "Off day"]
    assert out["offered"][7:] == ["E46", "Sam"]
    assert out["note"] == 280
