"""Low sun ahead, live (web/sun_ahead.js): on the road being followed, a stretch of 150 m or more beyond the call
distance that points into a sun 0-15 degrees up is said once, unless the road under the car already points at it, the
sun is high or down, or a known overcast or wet sky hides it; at most one call every 5 minutes."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const A = require(process.argv[1] + '/web/sun_ahead.js'), Sun = require(process.argv[1] + '/web/sun.js');
const LAT = 35.5, LON = -84.0, dusk = new Date('2026-06-21T00:20:00Z'), noon = new Date('2026-06-21T17:00:00Z');
const sp = Sun.sunPosition(dusk, LAT, LON);
// a track of legs [heading (rad), metres], 5 m samples
function track(legs) {
  const lat = [LAT], lon = [LON], dist = [0];
  for (const [h, len] of legs) for (let m = 5; m <= len; m += 5) {
    const k = Math.cos(lat[lat.length - 1] * Math.PI / 180);
    lat.push(lat[lat.length - 1] + 5 * Math.cos(h) / 110540); lon.push(lon[lon.length - 1] + 5 * Math.sin(h) / (111320 * k));
    dist.push(dist[dist.length - 1] + 5);
  }
  return { lat, lon, dist };
}
const bend = track([[sp.azimuth - Math.PI / 2, 300], [sp.azimuth, 600]]);
const out = {
  altDeg: sp.altitude * 180 / Math.PI,
  bend: A.ahead(bend, 0, dusk, Sun),
  bendNoon: A.ahead(bend, 0, noon, Sun),
  intoNow: A.ahead(track([[sp.azimuth, 900]]), 0, dusk, Sun),
  short: A.ahead(track([[sp.azimuth - Math.PI / 2, 300], [sp.azimuth, 100], [sp.azimuth - Math.PI / 2, 600]]), 0, dusk, Sun),
  behind: A.ahead(track([[sp.azimuth - Math.PI / 2, 300], [sp.azimuth + Math.PI, 600]]), 0, dusk, Sun),
  far: A.ahead(track([[sp.azimuth - Math.PI / 2, 1200], [sp.azimuth, 600]]), 0, dusk, Sun),
  noSun: A.ahead(bend, 0, dusk, null), noTrack: A.ahead(null, 0, dusk, Sun), pastEnd: A.ahead(bend, 5000, dusk, Sun),
  hidden: [['Dry', 1], ['Dry', 3], ['Rain', null], ['Wet roads', 0], ['Fog', 0], [null, null], [null, 3]].map(([w, c]) => A.hidden(w, c)),
  due: [A.due(100, null), A.due(100, 0), A.due(400, 99), A.due(400, 100)],
  text: A.TEXT,
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_bend_into_a_low_sun_is_found_beyond_the_call(out):
    assert 0 < out["altDeg"] <= 15
    b = out["bend"]
    assert b is not None and 280 <= b["start_m"] <= 320 and b["end_m"] - b["start_m"] >= 150


def test_no_call_when_it_is_not_a_surprise_or_not_there(out):
    assert out["bendNoon"] is None          # the sun is high
    assert out["intoNow"] is None           # the driver already looks at it
    assert out["short"] is None             # a glimpse under 150 m
    assert out["behind"] is None            # the sun at your back
    assert out["far"] is None               # past 900 m: too early to say
    assert out["noSun"] is None and out["noTrack"] is None and out["pastEnd"] is None


def test_the_sky_and_the_gap(out):
    assert out["hidden"] == [False, True, True, True, True, False, True]
    assert out["due"] == [True, False, True, True]
    assert out["text"] == "Sun in your eyes ahead."
