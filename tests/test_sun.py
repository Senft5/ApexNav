"""NOAA sunrise/sunset and Night Auto's day/night decisions."""
import json
import os
import shutil
import subprocess

import pytest


NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const { sunTimes, isDark, sunPosition } = require(process.argv[1]);
const fs = require('fs'), vm = require('vm');
const browser = { window: {} };
vm.runInNewContext(fs.readFileSync(process.argv[1], 'utf8'), browser);
const cases = [
  ['cincinnati_summer', '2026-06-21', 39.10, -84.51, '2026-06-21T04:00:00Z', '2026-06-21T16:00:00Z'],
  ['cincinnati_winter', '2026-12-21', 39.10, -84.51, '2026-12-21T05:00:00Z', '2026-12-21T17:00:00Z'],
  ['london_equinox', '2026-03-20', 51.5, -0.13, '2026-03-20T00:00:00Z', '2026-03-20T12:00:00Z'],
  ['polar_summer', '2026-06-21', 78, 15, '2026-06-20T23:00:00Z', '2026-06-21T11:00:00Z'],
  ['polar_winter', '2026-12-21', 78, 15, '2026-12-20T23:00:00Z', '2026-12-21T11:00:00Z'],
];
const out = {};
for (const [name, day, lat, lon, midnight, noon] of cases) {
  const times = sunTimes(new Date(day + 'T12:00:00Z'), lat, lon);
  out[name] = {
    sunrise: times.sunrise === null ? null : times.sunrise.toISOString(),
    sunset: times.sunset === null ? null : times.sunset.toISOString(),
    midnight: isDark(new Date(midnight), lat, lon),
    noon: isDark(new Date(noon), lat, lon),
    utcDates: [times.sunrise, times.sunset].every(t => t === null || t instanceof Date),
  };
}
// A UTC midnight can still be the previous solar calendar day in the Americas.
out.cincinnati_after_sunset = isDark(new Date('2026-06-22T02:00:00Z'), 39.10, -84.51);
out.browserApi = Object.keys(browser.window.ApexSun).sort();
const summer = sunTimes(new Date('2026-06-21T12:00:00Z'), 39.10, -84.51);
out.sunriseBoundary = [isDark(new Date(summer.sunrise.getTime() - 60000), 39.10, -84.51),
  isDark(new Date(summer.sunrise.getTime() + 60000), 39.10, -84.51)];
out.sunsetBoundary = [isDark(new Date(summer.sunset.getTime() - 60000), 39.10, -84.51),
  isDark(new Date(summer.sunset.getTime() + 60000), 39.10, -84.51)];
const deg = (p) => ({ alt: p.altitude * 180 / Math.PI, az: p.azimuth * 180 / Math.PI });
out.pos = { noon: deg(sunPosition(new Date('2026-06-21T17:40:00Z'), 39.10, -84.51)),
            rise: deg(sunPosition(summer.sunrise, 39.10, -84.51)), set: deg(sunPosition(summer.sunset, 39.10, -84.51)),
            winterRise: deg(sunPosition(sunTimes(new Date('2026-12-21T12:00:00Z'), 39.10, -84.51).sunrise, 39.10, -84.51)) };
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def results():
    path = os.path.abspath("web/sun.js")
    run = subprocess.run([NODE, "-e", RUNNER, path], capture_output=True, text=True, check=True)
    return json.loads(run.stdout)


@pytest.mark.parametrize("place,expected_rise,expected_set", [
    ("cincinnati_summer", "2026-06-21T10:11:00Z", "2026-06-22T01:07:00Z"),
    ("cincinnati_winter", "2026-12-21T12:54:00Z", "2026-12-21T22:17:00Z"),
    ("london_equinox", "2026-03-20T06:03:00Z", "2026-03-20T18:14:00Z"),
])
def test_sunrise_sunset_within_five_minutes(results, place, expected_rise, expected_set):
    from datetime import datetime

    actual = results[place]
    for event, expected in (("sunrise", expected_rise), ("sunset", expected_set)):
        delta = datetime.fromisoformat(actual[event].replace("Z", "+00:00")) - datetime.fromisoformat(expected.replace("Z", "+00:00"))
        assert abs(delta.total_seconds()) < 5 * 60, (place, event, actual[event])
    assert actual["utcDates"]


@pytest.mark.parametrize("place", ["cincinnati_summer", "cincinnati_winter", "london_equinox"])
def test_midnight_dark_and_noon_light(results, place):
    assert results[place]["midnight"] is True
    assert results[place]["noon"] is False


def test_polar_day_and_night_have_no_crossings(results):
    for place, dark in (("polar_summer", False), ("polar_winter", True)):
        assert results[place]["sunrise"] is None
        assert results[place]["sunset"] is None
        assert results[place]["midnight"] is dark
        assert results[place]["noon"] is dark
    assert results["cincinnati_after_sunset"] is True


def test_browser_export_and_boundaries(results):
    assert results["browserApi"] == ["isDark", "sunPosition", "sunTimes"]
    assert results["sunriseBoundary"] == [True, False]
    assert results["sunsetBoundary"] == [False, True]


def test_sun_position_altitude_and_azimuth(results):
    pos = results["pos"]
    # Cincinnati, June solstice: high in the south at noon, rising in the north-east, setting north-west.
    assert abs(pos["noon"]["alt"] - 74.3) < 1.0 and abs(pos["noon"]["az"] - 180) < 5
    assert abs(pos["rise"]["alt"] + 0.83) < 0.5 and abs(pos["rise"]["az"] - 58.5) < 2
    assert abs(pos["set"]["az"] - 301.5) < 2
    assert abs(pos["winterRise"]["az"] - 121) < 2, "December sunrise is in the south-east"
