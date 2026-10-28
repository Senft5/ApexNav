"""Seasonal and time-of-day closures (web/conditional_closures.js, IDEAS R-22): OSM conditional rules read for the time you'd
get there; a rule it can't read is shown as written, never guessed."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/conditional_closures.js');
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi);
const cases = {
  winterIn: C.closedAt('Nov 15-Apr 15', at(2026, 1, 10)), winterOut: C.closedAt('Nov 15-Apr 15', at(2026, 7, 4)),
  edge: C.closedAt('Dec 1-Mar 31', at(2026, 3, 31)), months: C.closedAt('Nov-Apr', at(2026, 4, 30)), years: C.closedAt('2026 Nov 01-2027 Apr 30', at(2026, 12, 25)),
  night: C.closedAt('19:00-07:00', at(2026, 10, 28, 23)), day: C.closedAt('19:00-07:00', at(2026, 10, 28, 12)),
  weekday: C.closedAt('Mo-Fr 07:00-09:00', at(2026, 10, 28, 8)), weekend: C.closedAt('Mo-Fr 07:00-09:00', at(2026, 10, 31, 8)),
  wrap: C.closedAt('Sa,Su 10:00-18:00', at(2026, 11, 1, 11)), odd: C.closedAt('wet', at(2026, 1, 1)), sunset: C.closedAt('sunset-sunrise', at(2026, 1, 1)),
};
const rules = C.closingRules('no @ (Nov 15-Apr 15); yes @ (Jul 4); destination @ (Mo-Fr 07:00-09:00)');
const ways = [
  { tags: { name: 'Clingmans Dome Road', 'motor_vehicle:conditional': 'no @ (Dec 1-Mar 31)' }, m: 9000, atMs: at(2027, 1, 15).getTime() },
  { tags: { name: 'Clingmans Dome Road', 'motor_vehicle:conditional': 'no @ (Dec 1-Mar 31)' }, m: 9500, atMs: at(2027, 1, 15).getTime() },
  { tags: { name: 'Gate Rd', 'access:conditional': 'no @ (19:00-07:00)' }, m: 2000, atMs: at(2026, 10, 28, 12).getTime() },
  { tags: { ref: 'NC 28', 'vehicle:conditional': 'no @ (wet)' }, m: 5000, atMs: at(2026, 10, 28, 12).getTime() },
  { tags: { name: 'Open Rd', 'access:conditional': 'yes @ (Mo-Fr)' }, m: 100, atMs: 0 },
];
const list = C.check(ways);
console.log(JSON.stringify({ cases, rules, list, line: C.summary(list), none: C.summary(C.check([])), q: C.query(35, -84, 36, -83) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_reading_rules(out):
    c = out["cases"]
    assert (c["winterIn"], c["winterOut"], c["edge"], c["months"], c["years"]) == (True, False, True, True, True)
    assert (c["night"], c["day"], c["weekday"], c["weekend"], c["wrap"]) == (True, False, True, False, True)
    assert c.get("odd") is None and c.get("sunset") is None                  # can't read it: unknown, not open
    assert out["rules"] == [{"cond": "Nov 15-Apr 15"}]


def test_route_card(out):
    assert [(x["name"], x["closed"]) for x in out["list"]] == [("Gate Rd", False), ("NC 28", None), ("Clingmans Dome Road", True)]
    assert out["line"] == "Closed when you'd get there (map data): Clingmans Dome Road (Dec 1-Mar 31) · Has access rules: NC 28 (wet)"
    assert out["none"] == ""
    assert 'way["highway"]["motor_vehicle:conditional"](35.0000,-84.0000,36.0000,-83.0000);' in out["q"]
