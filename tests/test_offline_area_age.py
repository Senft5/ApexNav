"""How old a saved offline area's map is (web/offline_tiles.js ageOf, IDEAS F-02): the Garage row says the month it was
saved, and half a year on it offers to update the area in place; a record with no date stays unknown."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const O = require(process.argv[1] + '/web/offline_tiles.js'), now = Date.parse('2026-11-13T12:00:00Z');
console.log(JSON.stringify({ fresh: O.ageOf({ at: '2026-10-01T09:00:00Z' }, now), old: O.ageOf({ at: '2026-03-02T09:00:00Z' }, now),
  edge: O.ageOf({ at: new Date(now - O.STALE_DAYS * 86400000).toISOString() }, now), none: O.ageOf({}, now), bad: O.ageOf({ at: 'x' }, now), nul: O.ageOf(null, now) }));
"""


def test_area_age():
    r = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert r["fresh"] == {"days": 43, "stale": False, "month": "Oct 2026"}
    assert r["old"]["stale"] is True and r["old"]["month"] == "Mar 2026"
    assert r["edge"]["stale"] is True, "half a year to the day"
    for k in ("none", "bad", "nul"):
        assert r[k] == {"days": None, "stale": False, "month": None}, "no date: unknown, never offered as old"


def test_garage_row_offers_update_in_place():
    src = open(os.path.join(ROOT, "web", "cockpit.js")).read()
    assert "const age = ApexOfflineTiles.ageOf(a, Date.now());" in src
    assert "saveAreaAt(a.lat, a.lon, up, { id: a.id, name: a.name, radiusKm: a.radiusKm, idle: 'Update' })" in src, "same id: the area is replaced, not doubled"
