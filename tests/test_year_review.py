"""Your year on the road (web/year_review.js, IDEAS D-24): only this year's drives with a known date; totals, months,
roads driven twice or more, best score and longest drive; no year, no summary; never speed or time."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const Y = require(process.argv[1] + '/web/year_review.js');
const MI = 1609.344, d = (name, date, mi, score, corners, extra = {}) => ({ name, date, dist: [0, mi * MI], ds: { score }, corners: Array(corners).fill({}), ...extra });
const drives = [
  d('Tail of the Dragon', '2026-04-02T10:00', 11, 702, 40), d('Tail of the Dragon', '2026-06-12T09:00', 11.2, 744, 41),
  d('Cherohala Skyway', '2026-06-20T08:00', 43.4, null, 60), d('Drive 4', '2026-09-01T08:00', 5, 610, 8),
  d('Old import', '2026-01-01T00:00:00Z', 900, 999, 500, { dateKnown: false }), d('Last year', '2025-11-01T10:00', 50, 900, 50),
];
const s = Y.summary(drives, 2026);
console.log(JSON.stringify({ s, lines: Y.lines(s), none: Y.summary(drives, 2024), unscored: Y.summary([d('X', '2026-01-02T10:00', 3, null, 2)], 2026) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_year_summary(out):
    s = out["s"]
    assert s["drives"] == 4 and s["miles"] == 70.6 and s["corners"] == 149 and s["months"] == 3
    assert s["topRoads"] == [{"name": "Tail of the Dragon", "times": 2}]
    assert s["best"] == {"name": "Tail of the Dragon", "score": 744, "date": "2026-06-12"}
    assert s["longest"] == {"name": "Cherohala Skyway", "miles": 43.4}


def test_lines_and_unknowns(out):
    assert out["lines"][0] == "71 mi in 4 drives · 149 corners · 3 months on the road"
    assert out["none"] is None
    assert out["unscored"]["best"] is None
    text = " ".join(out["lines"]).lower()
    assert "mph" not in text and "speed" not in text and "fastest" not in text


AREAS = r"""
const Y = require(process.argv[1] + '/web/year_review.js');
const MI = 1609.344, d = (name, date, lat, lon, mi = 10) => ({ name, date, dist: [0, mi * MI], ds: { score: 500 }, corners: [], bbox: [lat - 0.05, lat + 0.05, lon - 0.05, lon + 0.05] });
const all = [d('Tail of the Dragon', '2026-04-01T09:00', 35.5, -83.9), d('Tail of the Dragon', '2026-05-01T09:00', 35.52, -83.95),
  d('Cherohala Skyway', '2026-05-02T09:00', 35.35, -84.1), d('Blue Ridge Pkwy', '2026-06-01T09:00', 36.6, -81.5),
  d('Drive 4', '2026-07-01T09:00', 38, -80), { ...d('No box', '2026-07-02T09:00', 0, 0), bbox: null }];
const s = Y.summary(all, 2026), one = Y.summary(all.slice(0, 2), 2026);
console.log(JSON.stringify({ areas: s.areas, lines: Y.lines(s), one: one.areas, oneLines: Y.lines(one) }));
"""


def test_areas_where_you_drove():
    out = json.loads(subprocess.run([NODE, "-e", AREAS, ROOT], capture_output=True, text=True, check=True).stdout)
    # within 40 km of an area's first drive is that area, named after the road driven most there; a box-less drive is not placed
    assert out["areas"] == [{"name": "Tail of the Dragon", "drives": 3, "miles": 30}, {"name": "Blue Ridge Pkwy", "drives": 1, "miles": 10},
                            {"name": None, "drives": 1, "miles": 10}]
    assert "Where you drove: 3 areas, most around Tail of the Dragon (3 drives), then around Blue Ridge Pkwy (1 drive)" in out["lines"]
    # one area is not worth a line
    assert len(out["one"]) == 1 and not any(x.startswith("Where you drove") for x in out["oneLines"])


CREWS = r"""
const Y = require(process.argv[1] + '/web/year_review.js'), E = require(process.argv[1] + '/web/crew_events.js');
const mem = { v: {}, getItem(k) { return k in this.v ? this.v[k] : null; }, setItem(k, x) { this.v[k] = String(x); } };
const ev = (id, crew, at) => ({ id, crew_name: crew, starts_at: at, title: 'A drive', meet_lat: 35, meet_lon: -84 });
E.noteCame(mem, ev('e1', 'Smoky Crew', '2026-04-04T13:00:00Z'), true);
E.noteCame(mem, ev('e2', 'Smoky Crew', '2026-05-04T13:00:00Z'), true);
E.noteCame(mem, ev('e2', 'Smoky Crew', '2026-05-04T13:00:00Z'), true);      // twice is once
E.noteCame(mem, ev('e3', 'Tuesday Night', '2026-06-04T13:00:00Z'), true);
E.noteCame(mem, ev('e4', 'Tuesday Night', '2026-06-11T13:00:00Z'), true);
E.noteCame(mem, ev('e4', 'Tuesday Night', '2026-06-11T13:00:00Z'), false);   // "I wasn't there" takes it off
E.noteCame(mem, ev('e5', 'Old Crew', '2025-06-11T13:00:00Z'), true);
const crews = Y.crewYear(mem, 2026), s = Y.summary([{ name: 'X', date: '2026-01-02T10:00', dist: [0, 1000], ds: { score: null }, corners: [] }], 2026);
console.log(JSON.stringify({ crews, kept: JSON.parse(mem.v[E.CAME_KEY]), line: Y.lines({ ...s, crews }), none: Y.crewYear(null, 2026), bad: Y.crewYear({ getItem: () => '{oops' }, 2026) }));
"""


def test_crew_drives_kept_on_the_phone():
    out = json.loads(subprocess.run([NODE, "-e", CREWS, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["crews"] == [{"crew": "Smoky Crew", "drives": 2}, {"crew": "Tuesday Night", "drives": 1}]
    assert all(set(x) == {"id", "crew", "at"} for x in out["kept"])           # no place, no other driver
    assert "Crew drives: 2 with Smoky Crew, 1 with Tuesday Night" in out["line"]
    assert out["none"] == [] and out["bad"] == []
