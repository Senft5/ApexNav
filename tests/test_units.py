"""Units (web/units.js, IDEAS U-22): miles for the US and UK by default, km elsewhere; a saved choice wins; formats."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
Object.defineProperty(globalThis, 'navigator', { value: { language: 'de-DE' }, configurable: true });
const U = require(process.argv[1] + '/web/units.js');
const out = { choose: [U.choose(null, 'en-US'), U.choose(null, 'en-GB'), U.choose(null, 'en-AU'), U.choose(null, 'fr'), U.choose('imperial', 'fr'), U.choose('x', 'en-US')] };
out.metric = { sys: U.system(), long: U.long(19800), smart: U.long(25400, 1, true), short: [U.short(143), U.short(1500)], speed: Math.round(U.speed(25)), unit: U.speedU(), max: U.speedMax() };
U.set('imperial');
out.imperial = { sys: U.system(), saved: store['apex.units'], long: U.long(19800), short: [U.short(143), U.short(400)], speed: Math.round(U.speed(25)), unit: U.speedU(), max: U.speedMax(), nan: U.long(NaN) };
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_default_by_language_and_saved_choice(out):
    assert out["choose"] == ["imperial", "imperial", "metric", "metric", "imperial", "imperial"]


def test_metric(out):
    m = out["metric"]
    assert m["sys"] == "metric" and m["long"] == "19.8 km" and m["smart"] == "25 km"
    assert m["short"] == [{"n": "140", "u": "M"}, {"n": "1.5", "u": "KM"}]
    assert (m["speed"], m["unit"], m["max"]) == (90, "km/h", 220)


def test_imperial(out):
    i = out["imperial"]
    assert i["sys"] == "imperial" and i["saved"] == "imperial" and i["long"] == "12.3 mi"
    assert i["short"] == [{"n": "450", "u": "FT"}, {"n": "0.2", "u": "MI"}]
    assert (i["speed"], i["unit"], i["max"], i["nan"]) == (56, "mph", 140, "--")
