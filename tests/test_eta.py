"""Live ETA (web/eta.js): router time ahead, scaled by your pace so far, bounded and smoothed; unknown stays unknown."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const E = require(process.argv[1] + '/web/eta.js');
const out = {};
// 10 km the router times at 600 s: first 5 km slow (400 s), last 5 km fast (200 s)
const marks = [[5000, 400]];
out.left = [0, 2500, 5000, 7500, 10000, 12000].map(m => E.routerLeft(m, 10000, 600, marks));
out.linear = E.routerLeft(2500, 10000, 600, []);
out.badMarks = E.routerLeft(2500, 10000, 600, [[3000, 700], [NaN, 5], [12000, 50]]);   // more seconds than the route, NaN, past the end: ignored
out.unknown = [E.routerLeft(100, 10000, null), E.routerLeft(null, 10000, 600), E.routerLeft(100, 0, 600)];
// Drive a route at a pace, 1 fix a second; returns the arrival (min after the start) and the time-left text every 60 s.
const drive = (paceAt, o = {}) => {
  const total = o.total || 10000, timeS = o.timeS || 600, sections = o.sections || [], e = E.createEta(), arr = [], txt = [];
  let m = 0, t = 0, f = null;
  while (m < total && t < 7200) {
    const r = E.leftText && e.update({ t: t * 1000, atM: m, totalM: total, timeS, marks: [], sections });
    if (t % 60 === 0) { arr.push(+(r.arriveAt / 60000).toFixed(2)); txt.push(E.leftText(r.leftS, r.rough)); }
    m += (total / timeS) / paceAt(t, m); t++;
  }
  return { arr, txt, f: e.factors, took: t / 60 };
};
out.steady = drive(() => 1);
out.slow = drive(() => 1.3);
out.light = drive((t) => (t >= 180 && t < 270 ? 1e9 : 1));   // a 90 s red light at 3 min
out.crawl = drive(() => 5);                                    // a jam: capped pace, the arrival still moves with the clock
// U-108, Billet: 30 km timed at 1800 s; the first 10 km is an interstate join driven at twice the router's pace, the
// last 20 km a corner section driven at the router's pace.
out.join = drive((t, m) => (m < 10000 ? 0.5 : 1), { total: 30000, timeS: 1800, sections: [[10000, 30000]] });
out.joinOneClass = drive((t, m) => (m < 10000 ? 0.5 : 1), { total: 30000, timeS: 1800 });
const e = E.createEta(); e.update({ t: 0, atM: 0, totalM: 10000, timeS: 600 }); e.update({ t: 200000, atM: 3000, totalM: 10000, timeS: 600 }); e.reset();
out.reset = e.update({ t: 300000, atM: 5000, totalM: 10000, timeS: 600 });
out.unknownEta = [E.createEta().update({ t: 0, atM: 0, totalM: 10000, timeS: null }), E.createEta().update({ t: 0, atM: null, totalM: 10000, timeS: 600 })];
out.texts = [E.leftText(1980, true), E.leftText(1980, false), E.leftText(30, true), E.leftText(130, true), E.leftText(null, false)];
out.sections = E.cornerSections([{ type: 'corner', start_m: 1000, end_m: 1100 }, { type: 'corner', start_m: 1400, end_m: 1500 },
  { type: 'corner', start_m: 5000, end_m: 5100 }, { type: 'bump', start_m: 5200, end_m: 5300 }, { type: 'corner', start_m: 9000, end_m: 9050 },
  { type: 'corner', start_m: 9300, end_m: 9400 }, { type: 'corner', start_m: 9800, end_m: 9900 }]);
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    res = subprocess.run([NODE, "-e", RUNNER, os.path.abspath(".")], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_router_time_ahead_follows_its_maneuver_times(r):
    assert r["left"] == [600, 400, 200, 100, 0, 0]
    assert r["linear"] == 450
    assert r["badMarks"] == 450, "marks with more time than the route, or past its end, are ignored"
    assert r["unknown"] == [None, None, None]


def test_router_pace_keeps_the_card_arrival(r):
    assert all(abs(x - 10) < 0.1 for x in r["steady"]["arr"]), r["steady"]["arr"]


def test_pace_is_bounded_and_the_arrival_moves_at_most_a_minute_per_minute(r):
    """U-108: the factor stays within 0.85-1.25, and the arrival never moves more than a minute per minute driven."""
    for k in ("steady", "slow", "light", "crawl", "join", "joinOneClass"):
        f, arr = r[k]["f"], r[k]["arr"]
        assert all(0.85 - 1e-9 <= v <= 1.25 + 1e-9 for v in f.values()), (k, f)
        assert all(abs(b - a) <= 1.0 + 1e-6 for a, b in zip(arr, arr[1:])), (k, arr)
    assert r["slow"]["arr"][1] == pytest.approx(1 + (600 - 60 / 1.3) / 60, abs=0.02), "no pace before 2 min of driving: router time ahead"
    assert r["slow"]["f"]["open"] > 1.15, r["slow"]["f"]
    assert all(b >= a for a, b in zip(r["slow"]["arr"], r["slow"]["arr"][1:])), "slow driving only ever pushes the arrival later"
    assert r["crawl"]["f"]["open"] <= 1.25


def test_a_red_light_moves_the_arrival_with_the_clock_only(r):
    # the 90 s stop moves it 1.5 min; the pace it teaches adds under another minute
    assert max(r["light"]["arr"]) <= 12.5, r["light"]["arr"]


def test_a_fast_join_does_not_reprice_the_twisties(r):
    """U-108, Billet: an interstate join at twice the router's pace leaves the corner section's pace alone."""
    j = r["join"]
    assert j["f"]["corner"] == pytest.approx(1, abs=0.02) and j["f"]["open"] < 0.95
    # the router's 30 min, driven in 25: the arrival never walks back more than a minute per minute, and ends close to it
    assert min(j["arr"]) >= 25 - 0.5, j["arr"]
    assert all(b - a >= -1.0 - 1e-6 for a, b in zip(j["arr"], j["arr"][1:])), j["arr"]
    # one class for the whole route would have priced the corners at the join's pace
    assert r["joinOneClass"]["f"]["open"] < 0.9


def test_time_left_is_rough_until_five_miles_of_evidence(r):
    assert r["texts"] == ["about 35 min left", "33 min left", "<1 min left", "2 min left", ""]
    assert r["join"]["txt"][0] == "about 30 min left"
    assert all(t.startswith("about ") for t in r["join"]["txt"][:5]), r["join"]["txt"]
    assert not r["join"]["txt"][-1].startswith("about "), "under 10 min left (or past 5 miles) the minutes are exact"
    assert r["steady"]["txt"][0] == "10 min left", "a short route is never rounded under 10 min left"


def test_a_new_route_starts_over_and_unknown_stays_unknown(r):
    assert r["reset"]["leftS"] == 300 and r["reset"]["arriveAt"] == 600000
    assert r["unknownEta"] == [None, None]


def test_corner_sections_are_runs_of_corners(r):
    # a lone corner (5000) is open road; 1000-1500 and 9000-9900 are runs, padded 100 m
    assert r["sections"] == [[900, 1600], [8900, 10000]]


def test_home_by_offer():
    """IDEAS R-37: late by more than 5 min offers the way home, once, then again only after 10 min."""
    import json as _json, shutil as _sh, subprocess as _sp
    node = _sh.which("node")
    if not node:
        pytest.skip("node not installed")
    js = r"""
    process.env.TZ = 'America/New_York';
    const E = require(process.argv[1] + '/web/eta.js'), M = 60000, now = Date.parse('2026-10-30T22:00:00Z');   // 6 PM
    console.log(JSON.stringify({
      onTime: E.homeByOffer(now + 30 * M, now + 28 * M, null, now), late: E.homeByOffer(now + 40 * M, now + 30 * M, null, now),
      again: E.homeByOffer(now + 40 * M, now + 30 * M, now - 5 * M, now), later: E.homeByOffer(now + 40 * M, now + 30 * M, now - 11 * M, now),
      unset: E.homeByOffer(now + 40 * M, null, null, now),
      at7pm: new Date(E.homeByAt('19:00', now)).toISOString(), at6am: new Date(E.homeByAt('06:00', now)).toISOString(), bad: E.homeByAt('7pm', now),
    }));
    """
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = _json.loads(_sp.run([node, "-e", js, root], capture_output=True, text=True, check=True).stdout)
    assert out["onTime"] is None and out["late"] == {"lateMin": 10}
    assert out["again"] is None and out["later"] == {"lateMin": 10} and out["unset"] is None
    assert out["at7pm"] == "2026-10-30T23:00:00.000Z"          # tonight
    assert out["at6am"] == "2026-10-31T10:00:00.000Z"          # 6 AM is long gone today: tomorrow
    assert out["bad"] is None
