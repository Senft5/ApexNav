"""Reports asked ahead of a dead zone (IDEAS F-03): the cells a planned route runs through (web/privacy_zones.js
routeCells) and the kept reports still live (web/hazard_reports.js stillLive)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const Z = require(process.argv[1] + '/web/privacy_zones.js');
const H = require(process.argv[1] + '/web/hazard_reports.js');
const out = {};
// 60 km due north from 35.52, one point every 100 m
const lat = [], lon = [];
for (let i = 0; i <= 600; i++) { lat.push(35.52 + i * 100 / 110540); lon.push(-83.92); }
out.plain = Z.routeCells(lat, lon, [], 1500, 12).map((c) => c.key);
out.capped = Z.routeCells(lat, lon, [], 1500, 2).map((c) => c.key);
// a privacy zone on the route: its cell is never asked
out.zoned = Z.routeCells(lat, lon, [{ id: 'h', lat: 35.80, lon: -83.92, r: 500 }], 1500, 12).map((c) => c.key);
out.short = Z.routeCells([35.52, 35.53], [-83.92, -83.92], [], 1500, 12);
out.bad = [Z.routeCells(null, null, []), Z.routeCells([1], [1], [])];
const now = Date.parse('2026-11-12T12:00:00Z');
out.live = H.stillLive([{ id: 'a', expires_at: '2026-11-12 13:00:00' }, { id: 'b', expires_at: '2026-11-12 11:00:00' }, { id: 'c' }, null], now).map((h) => h.id);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    res = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_route_cells_in_driving_order_without_the_ends(out):
    # the start's cell (35.5) and the end's (36.1) are never asked; the cells between, in order
    assert out["plain"] == ["35.6,-83.9", "35.7,-83.9", "35.8,-83.9", "35.9,-83.9", "36.0,-83.9"]
    assert out["capped"] == ["35.6,-83.9", "35.7,-83.9"]


def test_route_cells_skip_a_privacy_zones_cell(out):
    assert "35.8,-83.9" not in out["zoned"]
    assert out["zoned"] == ["35.6,-83.9", "35.7,-83.9", "35.9,-83.9", "36.0,-83.9"]


def test_route_cells_nothing_for_a_short_or_bad_route(out):
    assert out["short"] == []
    assert out["bad"] == [[], []]


def test_still_live_drops_expired_reports(out):
    assert out["live"] == ["a", "c"]
