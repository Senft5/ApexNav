"""A loop has no Quick / Fun / Long way (the owner, 2026-11-10: "why do loops need a long way a fun and a quick? the whole
point is aimless driving"). Its own choice is which way to head: the really different loops found, each named by its way
(web/fun_route.js loopWay, loopOffer) and drawn as its own outline (web/route_card.js loopCards, loopOutline)."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from tests.page_source import cockpit_source

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="needs node")

PRELUDE = """
const F = require(%s), R = require(%s);
// a ring of road through the start (39, -84), its middle `r` degrees away on bearing `deg`
const ring = (deg, r = 0.05) => { const la = [], lo = [], k = Math.cos(39 * Math.PI / 180), b = deg * Math.PI / 180;
  const cy = 39 + r * Math.cos(b), cx = -84 + r * Math.sin(b) / k;
  for (let a = 0; a <= 360; a += 10) { const t = (a + deg + 180) * Math.PI / 180; la.push(cy + r * Math.cos(t)); lo.push(cx + r * Math.sin(t) / k); }
  return { lat: la, lon: lo }; };
// a figure of eight through the start, one ring north and one south: it heads nowhere
const around = () => { const n = ring(0), s = ring(180); return { lat: [...n.lat, ...s.lat], lon: [...n.lon, ...s.lon] }; };
""" % (json.dumps(str(ROOT / "web" / "fun_route.js")), json.dumps(str(ROOT / "web" / "route_card.js")))


def run(js: str):
    src = f"{PRELUDE} console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)


@needs_node
def test_a_loop_is_named_by_the_way_it_heads():
    names = run("[0, 45, 90, 135, 180, 225, 270, 315, 20, 340, 100].map((d) => F.loopWay(ring(d)).name)")
    assert names == ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest", "North", "North", "East"]
    deg = run("[0, 90, 200].map((d) => F.loopWay(ring(d)).deg)")
    assert all(abs(a - b) < 1 or abs(a - b) > 359 for a, b in zip(deg, [0, 90, 200]))


@needs_node
def test_a_loop_round_its_start_has_no_way_and_no_shape_is_unknown():
    """Unknown stays unknown: a loop that circles its start is not given a compass name, nor is a track with no shape."""
    assert run("[F.loopWay(around()), F.loopWay(null), F.loopWay({ lat: [39, 39.1], lon: [-84, -84] }), F.loopWay({ lat: [39, 39, 39], lon: [-84, -84, -84] })]") == [None] * 4
    assert run("[R.loopOutline(null), R.loopOutline({ lat: [39], lon: [-84] })]") == [None, None]


@needs_node
def test_the_loops_offered_head_different_ways_before_any_lookalike():
    out = run("""(() => {
      const it = (name, v, deg, km, timeS) => ({ v, item: { name, km, timeS, way: deg == null ? null : { deg, name: '' } } });
      const pick = (order, n) => F.loopOffer(order, n).map((x) => x.item.name);
      return {
        // the best, then the two that head elsewhere, though a near twin of the best ranks second
        ways: pick([it('best N', 90, 0, 40, 3000), it('twin N', 88, 10, 43, 3300), it('E', 80, 95, 41, 3100), it('SW', 70, 230, 39, 2900)]),
        // a loop round the start is its own way; the same loop twice is offered once
        around: pick([it('N', 90, 0, 40, 3000), it('N again', 89, 0, 40.1, 3010), it('around', 85, null, 40, 3200)]),
        // one that heads elsewhere but ranks far below (its rule broken: 1000 off) never jumps the queue
        far: pick([it('N', 90, 0, 40, 3000), it('N long', 80, 5, 50, 3600), it('S on the highway', -920, 180, 40, 2400)], 2),
        // all one way (a river on the other side): still up to three, the really different ones
        oneWay: pick([it('a', 90, 0, 40, 3000), it('b', 80, 10, 45, 3300), it('c', 70, 20, 50, 3700), it('d', 60, 5, 55, 4000)]),
        none: pick([]), one: pick([it('only', 1, 0, 40, 3000)]),
      }; })()""")
    assert out["ways"] == ["best N", "E", "SW"]
    assert out["around"] == ["N", "around"]
    assert out["far"] == ["N", "N long"]
    assert out["oneWay"] == ["a", "b", "c"]
    assert out["none"] == [] and out["one"] == ["only"]


@needs_node
def test_a_loops_cards_are_its_ways_with_time_corners_and_its_own_outline():
    cards = run("""(() => {
      const opt = (deg, timeS, corners) => { const t = deg == null ? around() : ring(deg); return { t: { ...t, events: Array.from({ length: corners }, () => ({ type: 'corner' })) }, timeS, way: F.loopWay(t) }; };
      const o = { kind: 'loop', picked: 1, list: [opt(0, 2340, 23), opt(135, 4980, 1), opt(null, null, 0)] };
      return { cards: R.loopCards(o), one: R.loopCards({ kind: 'loop', picked: 0, list: [opt(0, 2340, 23)] }), dest: R.loopCards({ kind: 'dest', picked: 0, list: [opt(0, 1, 1), opt(90, 1, 1)] }), none: R.loopCards(null) }; })()""")
    assert cards["one"] == [] and cards["dest"] == [] and cards["none"] == []      # nothing to choose; not a loop
    a, b, c = cards["cards"]
    assert [a["label"], a["time"], a["corners"], a["on"]] == ["North", "39 min", "23 corners", False]
    assert [b["label"], b["time"], b["corners"], b["on"]] == ["Southeast", "1:23", "1 corner", True]
    assert [c["label"], c["time"], c["corners"]] == ["Around here", "--", "0 corners"]   # an unknown time stays "--"
    for k in (a, b, c):
        o = k["outline"]
        pts = [tuple(map(float, p.split())) for p in re.split(r"[ML]", o["d"]) if p]
        assert len(pts) >= 8 and all(0 <= x <= o["w"] and 0 <= y <= o["h"] for x, y in pts)   # inside its box
        assert list(pts[0]) == o["start"]
    # north up: a loop that heads north starts at the bottom of its outline, one that heads southeast near the top left
    ay = [float(p.split()[1]) for p in re.split(r"[ML]", a["outline"]["d"]) if p]
    assert a["outline"]["start"][1] == max(ay)
    bx = [float(p.split()[0]) for p in re.split(r"[ML]", b["outline"]["d"]) if p]
    by = [float(p.split()[1]) for p in re.split(r"[ML]", b["outline"]["d"]) if p]
    assert b["outline"]["start"][0] < sum(bx) / len(bx) and b["outline"]["start"][1] < sum(by) / len(by)


def test_a_loop_is_planned_one_way_whatever_the_level_is():
    """The page: a loop's search, ranking, costing and reroute never read the destination level, and its card has no level."""
    src = cockpit_source()
    assert "const LOOP_STYLE = 'fun';" in src
    assert "loopLevels" not in src
    for line in src.splitlines():
        if re.search(r"loopCosting\(avoid|ApexOwnRouting\.loops\(|FunRoute\.loopRank\(", line):
            assert "funLevel" not in line and "LOOP_STYLE" in line, line.strip()[:160]
    assert "$('routeCardFun').hidden = t.id !== 'route_dest';" in src
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    ways = html[html.index('id="routeCardWays"') - 60:html.index('id="routeCardWays"') + 120]
    assert 'role="radiogroup"' in ways and "hidden" in ways
    assert html.index('id="routeCardLoop"') < html.index('id="routeCardWays"') < html.index('id="routeCardFun"')


def test_the_idle_maps_loop_suggestion_follows_the_dial():
    """It said "Loop from here · 45 mi" from launch on, whatever the dial was turned to, while Plan built the dial's loop."""
    src = cockpit_source()
    pick = src[src.index("function pickLoop(b) {"):]
    pick = pick[:pick.index("\n    }\n") ]
    assert "paintLoopSuggest()" in pick
