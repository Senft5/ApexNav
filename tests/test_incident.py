"""Crash check (web/incident.js, IDEAS D-17): a hard impact while moving, then a stop that lasts, asks "Are you OK?" once;
a pothole you drive on from, a dropped phone at a stop, or no motion data never does."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const I = require(process.argv[1] + '/web/incident.js');
// frames at 1 Hz: [speed m/s, impact g]; returns the seconds at which the detector said 'ask'
function run(frames, t0 = 0) {
  const d = I.createDetector(), asks = [];
  frames.forEach(([v, g], i) => { if (d.update({ t: t0 + i * 1000, speed_mps: v, impact_g: g }) === 'ask') asks.push(i); });
  return asks;
}
const cruise = (n, v = 20) => Array.from({ length: n }, () => [v, 0.3]);
const stop = (n) => Array.from({ length: n }, () => [0, 0.1]);
const out = {};
// crash: 20 m/s, a 12 g hit, decelerating to rest over 3 s, then still
out.crash = run([...cruise(10), [18, 12], [9, 2], [3, 1], ...stop(20)]);
// a pothole at speed, then driving on
out.pothole = run([...cruise(10), [20, 7], ...cruise(30)]);
// a stop at a light 30 s after a hard bump: too long after
out.lateStop = run([...cruise(10), [20, 7], ...cruise(20), ...stop(20)]);
// stopped, then rolling again after 4 s: not still long enough
out.briefStop = run([...cruise(10), [15, 8], [2, 1], ...stop(4), ...cruise(20)]);
// the phone dropped while parked
out.parked = run([...stop(10), [0, 9], ...stop(20)]);
// a 4 g knock: under the threshold
out.small = run([...cruise(10), [18, 4], ...stop(20)]);
// no motion data at all
out.noImu = run([...cruise(10), [18, null], ...stop(20)].map(([v]) => [v, null]));
// two crashes 2 minutes apart: one ask (cooldown)
out.cooldown = run([...cruise(10), [18, 12], ...stop(20), ...cruise(80), [18, 12], ...stop(20)]);
out.e911 = [I.emergencyNumber('en-US'), I.emergencyNumber('en-CA'), I.emergencyNumber('de-DE'), I.emergencyNumber('en'), I.emergencyNumber(undefined)];
out.text = I.helpText({ lat: 35.123456, lon: -83.987654 });
out.textUnknown = I.helpText(null);
out.smsIos = I.smsHref('+1 (555) 010-2030', 'hi there', true);
out.smsAnd = I.smsHref('555-0102', 'a&b', false);
out.smsNone = I.smsHref('call me', 'x', true);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_a_crash_asks_once_after_the_car_stays_still(out):
    assert out["crash"] == [21]   # impact at 10, at rest from 13, still for 8 s


def test_what_is_not_a_crash(out):
    for k in ("pothole", "lateStop", "briefStop", "parked", "small", "noImu"):
        assert out[k] == [], k


def test_one_ask_per_cooldown(out):
    assert len(out["cooldown"]) == 1


def test_emergency_number_by_region(out):
    assert out["e911"] == ["911", "911", "112", "112", "112"]


def test_help_text_and_links(out):
    assert "maps.apple.com/?ll=35.12346,-83.98765" in out["text"]
    assert "unknown" in out["textUnknown"] and "http" not in out["textUnknown"]
    assert out["smsIos"] == "sms:+15550102030&body=hi%20there"
    assert out["smsAnd"] == "sms:5550102?body=a%26b"
    assert out["smsNone"] is None


def test_wired():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    swift = open(os.path.join(ROOT, "ApexNavApp.swift"), encoding="utf-8").read()
    assert '<script src="incident.js"></script>' in html and 'data-toggle="crash"' in html and "crash: true }" in html
    assert "feedCrash(frame);" in html                                                  # every live frame, web and native
    assert '"\\"impact_g\\":' in swift                                             # the shell sends the 100 Hz impact peak
    assert "impact_g: this._takeImpact()" in open(os.path.join(ROOT, "web", "sensors.js"), encoding="utf-8").read()
