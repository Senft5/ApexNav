"""The route reveal and the card's hero (design pass, 2026-11-10): web/route_reveal.js (how a route found is drawn on, the
numbers counted up) and route_card.js strip / profileAt (the profile before its heights are in, and where the apex dot
sits on it). Unknown stays unknown: "--" is never counted towards, and no heights are drawn that weren't measured."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const V = require(process.argv[1] + '/web/route_reveal.js');
const R = require(process.argv[1] + '/web/route_card.js');
const dist = [], elev = [];
for (let i = 0; i <= 200; i++) { dist.push(i * 50); elev.push(300 + 200 * Math.sin(i / 200 * Math.PI)); }
const ev = [{ type: 'corner', dist_m: 1000, severity: '2' }, { type: 'corner', dist_m: 5000, severity: 'HP' }, { type: 'bump', dist_m: 3000 }];
const a = { id: 'route_dest', name: 'To Maryville' }, b = { id: 'route_dest', name: 'To Maryville' };
console.log(JSON.stringify({
  plan: { found: V.plan(null, a, false), swap: V.plan(a, b, false), other: V.plan(a, { id: 'road', name: 'X' }, false), still: V.plan(null, a, true),
    loops: V.plan({ id: 'loop_1', name: '30 mi loop' }, { id: 'loop_2', name: '28 mi loop' }, false), same: V.plan(a, a, false) },
  count: [V.countText('94', 0), V.countText('94', 0.5), V.countText('94', 1), V.countText('22.8', 0.5), V.countText('1:23', 0.5), V.countText('1:23', 0),
    V.countText('--', 0.3), V.countText('Look further', 0.3), V.countText('22.8', 1)],
  ease: [V.ease(0), V.ease(0.5), V.ease(1), V.ease(2), V.ease(NaN)],
  grad: V.gradient('#111', 0.4), grad0: V.gradient('#111', 0),
  strip: R.strip({ dist, events: ev }, 340, 80), noStrip: [R.strip(null), R.strip({ dist: [0] }), R.strip({ dist: [5, 5] })],
  at: [R.profileAt({ dist, elev, events: ev }, 5000, 340, 80), R.profileAt({ dist, elev }, 0, 340, 80), R.profileAt({ dist, elev }, 1e9, 340, 80),
    R.profileAt({ dist }, 2500, 340, 80), R.profileAt({ dist: [0] }, 0)],
}));
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_a_route_found_is_drawn_and_counted_a_swap_is_quick_reduced_motion_is_a_cut(out):
    p = out["plan"]
    assert p["found"] == {"lineMs": 800, "countMs": 500, "swap": False}          # 600 to 900 ms, the numbers with it
    assert p["swap"] == {"lineMs": 300, "countMs": 0, "swap": True}             # a level card: a quick redraw, no count
    assert p["loops"]["swap"] and p["loops"]["lineMs"] == 300                   # one loop's way for another
    assert p["other"]["lineMs"] == 800 and not p["other"]["swap"]               # a different route is a new find
    assert p["still"] == {"lineMs": 0, "countMs": 0, "swap": False}             # reduced motion: the finished line
    assert p["same"]["lineMs"] == 800 and not p["same"]["swap"]


def test_numbers_count_up_in_their_own_format_and_unknown_is_never_counted(out):
    assert out["count"] == ["0", "47", "94", "11.4", "0:42", "0:00", "--", "Look further", "22.8"]
    e = out["ease"]
    assert e[0] == 0 and e[2] == 1 and e[3] == 1 and e[4] == 1 and e[1] > 0.5   # arrives fast, settles into the end


def test_the_line_is_drawn_by_its_own_progress(out):
    assert out["grad"] == ["step", ["line-progress"], "#111", 0.4, "rgba(0,0,0,0)"]
    assert out["grad0"][3] > 0                                                   # a step needs a stop above 0


def test_before_the_heights_the_profile_is_the_road_and_its_corners_with_no_ground(out):
    s = out["strip"]
    assert s.startswith('<svg class="rc-profile rc-strip"') and "Heights unknown" in s
    assert "rc-ground" not in s and s.count('<path d="M') == 2                  # two corners, not the bump; no made-up hills
    assert out["noStrip"] == [None, None, None]


def test_the_apex_dot_sits_on_the_profile_where_you_are(out):
    mid, start, end, flat, none = out["at"]
    assert abs(mid["fx"] - 0.5) < 1e-9 and mid["fy"] < 0.3                      # halfway, at the top of the hill
    assert start["fx"] == 0 and abs(start["fy"] - 58 / 80) < 1e-9               # the start, on the ground line's low end
    assert end["fx"] == 1                                                        # clamped to the route
    assert flat == {"fx": 0.25, "fy": 72 / 80}                                   # no heights: on the foot line
    assert none is None


def test_the_ranked_route_after_the_early_one_is_not_drawn_twice():
    """A slow phone (THROTTLE=6, 2026-11-11) saw the line drawn, then drawn again from nothing when the ranked route
    replaced the early quickest after the first stroke had ended. That replacement now takes the line whole (penCarry);
    a re-plan you ask for (a level card) still redraws quickly."""
    import os
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "cockpit.js"), encoding="utf-8").read()
    assert "penCarry = !!shownEarly;" in src
    assert "try { t = await useOption(lv, lv.picked, ownUsed ? OWN_SIGHT_MS : undefined); } finally { penCarry = false; }" in src
    assert "carried = !pen && penCarry;" in src and "if (!(ms > 0) || carried || !window.ApexReveal) return;" in src
