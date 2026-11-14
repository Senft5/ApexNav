"""Speed limit drops ahead (web/limit_ahead.js): where the posted limit on the road being followed falls by 15 km/h or more
within 900 m, and the car is over the new one, the co-driver says "Limit 35 ahead." early enough to slow easily; never for
an unknown limit, a small step, or when already slow enough."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const A = require(process.argv[1] + '/web/limit_ahead.js');
const MPH = 0.44704, mph = (v) => v / MPH;
// 5 m samples over 3 km: 55 mph to 1500 m, then 35 mph
const dist = Array.from({ length: 601 }, (_, i) => i * 5);
const lim = (f) => ({ dist, limitMps: dist.map(f) });
const town = lim((m) => (m < 1500 ? 55 : 35) * MPH);
const drop = A.next(town, 1000);
const out = {
  drop: drop && [drop.atM, Math.round(mph(drop.limitMps)), Math.round(mph(drop.fromMps))],
  far: A.next(town, 400),                                                     // 1100 m away: beyond the 900 m reach
  small: A.next(lim((m) => (m < 1500 ? 55 : 50) * MPH), 1000),                // 5 mph: no call
  unknownHere: A.next(lim((m) => (m < 1500 ? null : 35 * MPH)), 1000),        // nothing known at the car
  gap: A.next(lim((m) => (m < 1200 ? 55 * MPH : m < 1400 ? null : 55 * MPH)), 1000),   // a gap in the data is no drop
  upDown: (() => { const d = A.next(lim((m) => (m < 1200 ? 55 : m < 1500 ? 65 : 35) * MPH), 1000); return d && d.atM; })(),
  // at 55 mph (24.6 m/s): 3 s plus an easy slowing to 35 mph, about 196 m
  callM: Math.round(A.callM(55 * MPH, 35 * MPH)),
  dueFar: A.due(drop, 1500 - 300, 55 * MPH), dueNow: A.due(drop, 1500 - 180, 55 * MPH),
  dueSlow: A.due(drop, 1500 - 180, 36 * MPH), dueAtSign: A.due(drop, 1500 - 20, 55 * MPH), dueNone: A.due(null, 1000, 30),
  text: A.text(35 * MPH, (v) => v * 2.2369362921), textKmh: A.text(50 / 3.6, (v) => v * 3.6), textOdd: A.text(34.2 * MPH, (v) => v * 2.2369362921),
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_drop_into_town(out):
    assert out["drop"] == [1500, 35, 55]
    assert out["upDown"] == 1500          # a short 65 before the town is still a drop below the limit at the car


def test_no_call_for_what_isnt_a_drop(out):
    assert out["far"] is None and out["small"] is None
    assert out["unknownHere"] is None and out["gap"] is None


def test_said_early_enough_to_slow_easily_and_only_when_over(out):
    assert 190 <= out["callM"] <= 200
    assert out["dueFar"] is False and out["dueNow"] is True
    assert out["dueSlow"] is False and out["dueAtSign"] is False and out["dueNone"] is False


def test_the_line_in_the_drivers_units(out):
    assert out["text"] == "Limit 35 ahead." and out["textKmh"] == "Limit 50 ahead." and out["textOdd"] == "Limit 35 ahead."


def test_wired_first_through_the_quiet_gate():
    js = open(os.path.join(ROOT, "web", "cockpit.js")).read()
    assert "const quiet = limitSay || brakeSay || sunSay || breakSay || flowSay;" in js
    assert "ApexLimitAhead.due(drop, state.cursorM, vMps)" in js and "drive.limitSaid = null" in js
    assert '<script src="limit_ahead.js" defer></script>' in open(os.path.join(ROOT, "web", "index.html")).read()
