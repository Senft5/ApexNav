"""Local legends (web/legends.js, IDEAS S-08): each day's best to publish, once; the legend is most days, never fastest."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const L = require(process.argv[1] + '/web/legends.js');
const now = Date.parse('2026-10-28T12:00:00Z');
const pass = (date, score, t = 300) => ({ d: { date }, p: { score, time_s: t } });
const bests = L.dayBests([pass('2026-10-27T08:00:00', 700), pass('2026-10-27T09:00:00', 760, 290), pass('2026-10-20T08:00:00', 650),
  pass('2026-08-01T08:00:00', 999), pass('nope', 800), { d: { date: '2026-10-26T08:00:00' }, p: { score: null } }], now);
const rows = [{ handle: 'fast', driver_score: 990, days_month: 2 }, { handle: 'bob', driver_score: 700, days_month: 6 },
  { handle: 'cara', driver_score: 720, days_month: 6 }, { handle: null, mine: true, driver_score: 600, days_month: 3 }];
console.log(JSON.stringify({ bests, pub: L.toPublish('s1', bests, { 's1|2026-10-27': 760 }), again: L.toPublish('s1', bests, { 's1|2026-10-27': 700 }).map((b) => b.day),
  legend: L.legend(rows), text: L.legendText(L.legend(rows)), none: L.legend(rows.slice(0, 1)), mine: L.legendText(L.legend([rows[3]])) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_day_bests_and_publishing_once(out):
    assert out["bests"] == [{"day": "2026-10-27", "score": 760, "time_s": 290}, {"day": "2026-10-20", "score": 650, "time_s": 300}]
    assert [b["day"] for b in out["pub"]] == ["2026-10-20"]                 # the 27th was sent with this score already
    assert out["again"] == ["2026-10-27", "2026-10-20"]                      # a better run that day is sent again


def test_legend_is_most_days_never_fastest(out):
    assert out["legend"]["handle"] == "cara" and out["legend"]["days"] == 6   # tie on days: the higher score
    assert out["text"] == "Local legend this month: @cara, on 6 different days"
    assert out["none"] is None
    assert out["mine"] == "Local legend this month: you, on 3 different days"
