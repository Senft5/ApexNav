"""A profile's head (web/profile_head.js, Garage as a profile, 2026-11-16): counts read short and unknown stays --; the car
named is the daily one, else the first."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const H = require(process.argv[1] + '/web/profile_head.js');
console.log(JSON.stringify({
  counts: [null, undefined, -1, 'x', 0, 7, 999, 1000, 1234, 9999, 12345].map(H.count),
  cars: [
    H.carName([{ year: 2004, make: 'Honda', model: 'S2000' }, { year: 2019, make: 'Mazda', model: 'MX-5', is_primary: 1 }]),
    H.carName([{ year: 2004, make: 'Honda', model: 'S2000' }]),
    H.carName([{ nickname: 'Blue' }]),
    H.carName([]), H.carName(null),
  ],
}));
"""


def run():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60, check=True).stdout)


def test_counts_short_and_unknown_dashes():
    assert run()["counts"] == ["--", "--", "--", "--", "0", "7", "999", "1k", "1.2k", "9.9k", "12k"]


def test_car_daily_first():
    assert run()["cars"] == ["2019 Mazda MX-5", "2004 Honda S2000", '"Blue"', None, None]
