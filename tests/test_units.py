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
U.set('metric');
globalThis.ApexUnits = U;                                     // the modules read it when present
const C = require(process.argv[1] + '/web/convoy.js'), S = require(process.argv[1] + '/web/scenic.js'), W = require(process.argv[1] + '/web/week_digest.js');
out.modules = { convoy: [C.distText(250), C.distText(4200), C.hazardPhrase('bump', 400), C.hazardPhrase('bump', 1000), C.hazardPhrase('bump', 3000)],
  scenic: S.summary([], 120000), week: W.lines({ miles: 10, drives: 2, newRoads: 0, best: null, focus: null })[0] };
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


def test_other_modules_in_metric(out):
    m = out["modules"]
    assert m["convoy"] == ["300 m", "4.2 km", "Bump ahead, 400 metres.", "Bump ahead, 1 kilometre.", "Bump ahead, 3.0 kilometres."]
    assert m["scenic"] == "No fuel on the way"
    assert m["week"] == "16 km in 2 drives"                 # RA-3: whole from 10, as every distance (format.js distance)


def test_a_size_set_in_metres_is_labelled_in_the_drivers_units():
    """2026-11-10: privacy zones offered "200 m / 500 m / 1 km" to a driver in miles, and a crew's page said "11 km across"."""
    js = r"""
const store = {}; globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
const U = require(process.argv[1] + '/web/units.js');
U.set('metric'); const m = [200, 500, 1000, 1500, NaN].map(U.size);
U.set('imperial'); const i = [200, 500, 1000].map(U.size);
console.log(JSON.stringify({ m, i }));
"""
    out = json.loads(subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["m"] == ["200 m", "500 m", "1 km", "1.5 km", "--"]
    assert out["i"] == ["650 ft", "0.3 mi", "0.6 mi"]
    page = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "b.textContent = ApexUnits.size(Number(b.dataset.zoneR));" in page and "labelLoops(); renderZones();" in page
    assert "`${zoneR} m`" not in page and "under 0.2 mi are dropped.'" not in page
    assert "'7 mile' : '11 km'" in open(os.path.join(ROOT, "web", "crew_page.js"), encoding="utf-8").read()


def test_small_lengths_in_the_log_are_in_the_drivers_units():
    """2026-11-10: the Log said "up 34 m", "Make it at least 200 m long", "braking point typically within 6 m" and "from
    100 m before turn-in" to a driver in miles."""
    js = r"""
const store = {}; globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
const U = require(process.argv[1] + '/web/units.js');
U.set('metric'); const m = [3, 5, 12.4, 20, NaN].map(U.fine);
U.set('imperial'); const i = [3, 5, 12.4, 20, 100].map(U.fine);
console.log(JSON.stringify({ m, i }));
"""
    out = json.loads(subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["m"] == ["3 m", "5 m", "12 m", "20 m", "--"]
    assert out["i"] == ["10 ft", "15 ft", "40 ft", "65 ft", "330 ft"]          # to the nearest 5 ft: no finer than was measured
    log = open(os.path.join(ROOT, "web", "analysis.html"), encoding="utf-8").read()
    view = open(os.path.join(ROOT, "web", "drive_view.js"), encoding="utf-8").read()
    for old in ("Make it at least 200 m long", "(fewer metres)", "floor near 3 m", "'under 3 m'", "Math.round(Math.abs(dz))} m"):
        assert old not in log, old
    for old in ("One for every 5 m of the drive", "(5 m samples and GPS make about 3 m the floor)", "Math.round(x))} m`;"):
        assert old not in view, old
    assert "ApexUnits.size(200)" in log and "U().size(100)" in view
