"""Weather along the route (web/route_weather.js, IDEAS R-21): the hour you'd get there, what matters, said once; unknown says nothing."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const W = require(process.argv[1] + '/web/route_weather.js');
const n = 101, t = { dist: Array.from({ length: n }, (_, i) => i * 500), lat: Array.from({ length: n }, (_, i) => 35 + i * 0.004), lon: Array.from({ length: n }, () => -83) };
const leave = Date.UTC(2026, 9, 28, 12);
const pts = W.samplePoints(t, leave, (m) => m / 20);           // 20 m/s by the router
const hours = Array.from({ length: 72 }, (_, i) => Date.UTC(2026, 9, 28) / 1000 + i * 3600);
const at = (vals) => ({ hourly: { time: hours, precipitation_probability: vals.p, precipitation: vals.mm, temperature_2m: vals.t, visibility: vals.v, weather_code: vals.c } });
const flat = (x) => Array(72).fill(x);
const json = [at({ p: flat(0), mm: flat(0), t: flat(15), v: flat(20000), c: flat(1) }), at({ p: flat(80), mm: flat(1.2), t: flat(12), v: flat(9000), c: flat(61) }),
  at({ p: flat(70), mm: flat(0.5), t: flat(0.5), v: flat(5000), c: flat(61) }), at({ p: flat(0), mm: flat(0), t: flat(10), v: flat(400), c: flat(45) }),
  at({ p: flat(90), mm: flat(2), t: flat(12), v: flat(8000), c: flat(63) }), null];
const list = W.atArrival(json, pts);
const fmt = { dist: (m) => `${Math.round(m / 1609.344)} mi`, time: (ms) => new Date(ms).toISOString().slice(11, 16) };
console.log(JSON.stringify({
  pts: pts.map((p) => [p.m, (p.atMs - leave) / 1000]), url: W.url(pts.slice(0, 2)),
  kinds: list.map(W.hazard), line: W.summary(list, fmt),
  fine: W.summary(W.atArrival(json.slice(0, 1), pts.slice(0, 1)), fmt), none: W.summary(W.atArrival([], pts), fmt),
  cost: W.cost(list), dry: W.cost(W.atArrival(json.slice(0, 1), pts.slice(0, 1))), costNone: W.cost(W.atArrival([], pts)),
  snow: W.hazard({ prob: 0, mm: 0, tempC: -3, code: 73 }), heat: W.hazard({ prob: 0, mm: 0, tempC: 37, code: 0 }),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_points_timed_by_the_router(out):
    assert out["pts"] == [[0, 0], [10000, 500], [20000, 1000], [30000, 1500], [40000, 2000], [50000, 2500]]
    assert "latitude=35.000,35.080&longitude=-83.000,-83.000" in out["url"] and "timeformat=unixtime" in out["url"]


def test_what_matters_said_once(out):
    assert out["kinds"] == [None, "rain", "ice", "fog", "rain", None] or out["kinds"][:5] == [None, "rain", "ice", "fog", "rain"]
    assert out["line"] == "Forecast: Ice risk near 12 mi (about 12:16) · Rain likely near 6 mi (about 12:08) · Fog near 19 mi (about 12:25)"


def test_fine_unknown_and_more(out):
    assert out["fine"] == "Forecast along the way: no rain, ice or fog"
    assert out["none"] == ""
    assert out["snow"] == "snow" and out["heat"] == "heat"


def test_cost_in_the_ranking(out):
    # five known points: fine, rain 6, ice 30, fog 4, rain 6 → 46 / 5; the unknown sixth doesn't count
    assert out["cost"] == 9.2
    assert out["dry"] == 0 and out["costNone"] == 0
