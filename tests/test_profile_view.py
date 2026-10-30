"""A friend's profile (web/profile_view.js, IDEAS S-15): what they share with you, as lines; nothing shared, said so."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/profile_view.js');
const full = { handle: 'bob', name: 'Bob Smith', friends_since: '2026-09-01', crews: ['Ridge Runners'],
  cars: [{ year: 1990, make: 'Mazda', model: 'MX-5', nickname: 'Pip', is_primary: 1 }],
  stages: [{ stage: 'Esses', best: 812, days_month: 3 }, { stage: 'Dry Ridge', best: 700, days_month: 0 }], totals: { stages: 2, days_month: 3, best: 812 } };
const now = Date.parse('2026-10-30T12:00:00Z');
console.log(JSON.stringify({ full: P.lines(full, now), bare: P.lines({ handle: 'cara', cars: [], crews: [], stages: [], totals: { stages: 0, days_month: 0, best: null } }) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_full_profile(out):
    f = out["full"]
    assert f["title"] == "@bob" and f["sub"] == "Bob Smith · friends since September"
    heads = {s["head"]: s["rows"] for s in f["sections"]}
    assert heads["This month"] == ["2 stages shared with you · 3 days on them this month · best Vetta Score 812"]
    assert heads["Favourite roads"] == ["Esses · best 812 · 3 days this month", "Dry Ridge · best 700"]
    assert heads["Garage"] == ['1990 Mazda MX-5 "Pip" · daily'] and heads["Crews you share"] == ["Ridge Runners"]


def test_nothing_shared(out):
    b = out["bare"]
    assert b["sub"] == "" and [s["head"] for s in b["sections"]] == ["This month"]
    assert b["sections"][0]["rows"] == ["No scores shared with you yet."]


SPOKEN = r"""
const P = require(process.argv[1] + '/web/profile_view.js');
const now = Date.parse('2026-10-30T12:00:00Z');
console.log(JSON.stringify({
  sub: P.lines({ handle: 'cara', name: 'Cara Nieves', friends_since: '2026-08-14', totals: {} }, now).sub,
  before: P.since('2025-03-02', now), bad: P.since('soon', now),
  cars: [{ year: 2023 }, { year: 2023, nickname: 'Blue' }, { make: 'Mazda', model: 'Miata' }, {}].map(P.car) }));
"""


def test_spoken_dates_and_cars_never_a_bare_year():
    """REVIEW_PEOPLE P-24: "friends since August", not an ISO date; a car by what it is before its year."""
    o = json.loads(subprocess.run([NODE, "-e", SPOKEN, ROOT], capture_output=True, text=True, check=True).stdout)
    assert o["sub"] == "Cara Nieves · friends since August"
    assert o["before"] == "friends since March 2025" and o["bad"] is None
    assert o["cars"] == ["A 2023 car", '"Blue" · 2023', "Mazda Miata", "A car"]
