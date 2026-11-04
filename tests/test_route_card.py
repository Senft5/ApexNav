"""The route card as instruments (web/route_card.js, docs/design/REVIEW.md roadmap 5): three stamped numbers, the profile
with a tick per corner, half-dials and the level cards. Unknown stays "--"."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = require(process.argv[1] + '/web/route_card.js');
const ev = (n) => ({ events: Array.from({ length: n }, (_, k) => ({ type: 'corner', dist_m: k * 10 })).concat([{ type: 'bump', dist_m: 5 }]) });
const F = require(process.argv[1] + '/web/fun_route.js');
const mi = (m) => `${(m / 1609.344).toFixed(1)} mi`;
const dist = [], elev = [];
for (let i = 0; i <= 200; i++) { dist.push(i * 50); elev.push(300 + 200 * Math.sin(i / 200 * Math.PI)); }
const t = { dist, elev, timeS: 10080, extraS: 720, events: [{ type: 'corner', dist_m: 1000, severity: '2' }, { type: 'corner', dist_m: 5000, severity: 'HP' },
  { type: 'bump', dist_m: 3000 }] };
const out = {
  dur: [R.duration(10080), R.duration(2880), R.duration(null), R.duration(-5)],
  stats: R.stats(t, mi),
  statsUnknown: R.stats({}, mi),
  profile: R.profile(t, 340, 92, (m) => `${Math.round(m)} m`),
  noProfile: [R.profile({ dist: [0], elev: [1] }), R.profile({ dist: [0, 10], elev: [null, null] }), R.profile(null)],
  dial: R.dial('Twist', 97), dialUnknown: R.dial('Surface', null), count: R.count('Cameras', 0), countUnknown: R.count('Cameras', undefined),
  // U-115: a GPX or a loop has no router fun score: Twist and Flow come from its own corners
  gpxShape: (() => { const ev = []; for (let k = 0; k < 12; k++) ev.push({ type: 'corner', dist_m: 600 + k * 120, start_m: 560 + k * 120, end_m: 640 + k * 120, severity: 3 });
    return R.shape({ dist, events: ev }, (x) => F.score(x, [])); })(),
  searchedShape: R.shape({ dist, events: [], fun: { fun: 60, twist: 56, flow: 23 } }, () => ({ twist: 1, flow: 1 })),
  noShape: [R.shape({ dist: [0, 10] }, (x) => F.score(x, [])), R.shape(null)],
  fact: R.factText('Ahead: Esses at 2.4 mi · Technical at 3.4 and 8.5 mi'),
  glyphs: ['1 café', '2 viewpoints · 1 café', 'No fuel for the first 40 mi', ''].map(R.alongGlyph),
  // the level cards (the owner, 2026-11-04): Quick and Fun pick the same route, Long way another, one more found
  levels: (() => { const o = { list: [{ timeS: 6780, t: ev(118) }, { timeS: 7920, t: ev(90) }, { timeS: 2880, t: ev(1) }, { timeS: null }], levels: { quick: 0, fun: 0, max: 1 }, picked: 0 };
    return { cards: R.levelCards(o, 'fun'), note: R.levelNote(o), onMax: R.levelCards({ ...o, picked: 1 }, 'max').map((c) => c.on), noteMax: R.levelNote({ ...o, picked: 1 }),
      other: R.levelCards({ ...o, picked: 2 }, 'fun').map((c) => c.on), noteOther: R.levelNote({ ...o, picked: 2 }),
      unknown: R.levelCards({ ...o, list: [{ timeS: null }], levels: { quick: 0, fun: 0, max: 0 } }, 'fun')[0] }; })(),
  // a plan at Fun didn't look as far as Long way: its card says so, with no numbers; all three the same: said once
  further: R.levelCards({ list: [{ timeS: 3000, t: ev(4) }, { timeS: 3600, t: ev(30) }], levels: { quick: 0, fun: 1, max: null }, picked: 1 }, 'fun'),
  furtherNote: R.levelNote({ list: [{ timeS: 3000, t: ev(4) }, { timeS: 3600, t: ev(30) }], levels: { quick: 0, fun: 1, max: null }, picked: 1 }),
  allSame: R.levelNote({ list: [{ timeS: 3000, t: ev(4) }], levels: { quick: 0, fun: 0, max: 0 }, picked: 0 }),
  planning: R.levelCards(null, 'max'),
  // the plan flow (finding 1): the card says the ranked swap in its own numbers
  swap: [R.swapNote({ timeS: 3540, events: ev(80).events }, { timeS: 3060, events: ev(28).events }), R.swapNote({ timeS: 3000, t: ev(10) }, { timeS: 3180, t: ev(11) }),
    R.swapNote({ timeS: 3000, t: ev(10) }, { timeS: 3000, t: ev(10) }, 'Avoids 2.2 mi of side streets'), R.swapNote({ timeS: 3000 }, { timeS: 3000 })],
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_stamped_numbers(out):
    assert out["dur"] == [{"value": "2:48", "unit": "h"}, {"value": "48", "unit": "min"}, None, None]
    assert out["stats"] == [{"value": "6.2", "unit": "mi", "label": "distance"}, {"value": "2:48", "unit": "h", "label": "+12 min for fun"},
                            {"value": "2", "unit": "", "label": "corners"}]
    assert [s["value"] for s in out["statsUnknown"]] == ["--", "--", "--"]


def test_profile_ticks_every_corner_and_names_the_top(out):
    p = out["profile"]
    assert p.startswith('<svg class="rc-profile"') and p.count('<path d="M') == 2      # two corners, not the bump
    assert ">500 m</text>" in p                                                          # the highest point
    assert out["noProfile"] == [None, None, None]


def test_dials_show_unknown_honestly(out):
    assert "<b>97</b>" in out["dial"] and "rc-arc" in out["dial"] and "unknown" not in out["dial"]
    assert "<b>--</b>" in out["dialUnknown"] and "unknown" in out["dialUnknown"] and "rc-needle" not in out["dialUnknown"]
    assert "<b>0</b>" in out["count"] and "<b>--</b>" in out["countUnknown"]               # none found is 0; not checked is --


def test_the_levels_are_the_cards(out):
    # the owner, 2026-11-04: one control. Each level is a card with its own pick's time and corners (every corner, as the
    # card's CORNERS number counts them, the bump not); two levels on the same route are both on, and the line says so
    lv = out["levels"]
    assert [(c["label"], c["time"], c["corners"], c["on"], c["same"]) for c in lv["cards"]] == [
        ("Quick", "1:53", "118 corners", True, ["Fun"]), ("Fun", "1:53", "118 corners", True, ["Quick"]), ("Long way", "2:12", "90 corners", False, [])]
    assert lv["note"] == "Quick and Fun pick the same route · swipe the card for the next route, 1\u00a0of\u00a04"
    assert lv["onMax"] == [False, False, True] and lv["noteMax"].endswith("2\u00a0of\u00a04")
    # a swipe past the levels' picks: another route found, no card on, and the line says how to get back
    assert lv["other"] == [False, False, False] and lv["noteOther"].endswith("another route found, 3\u00a0of\u00a04: swipe for the others")
    assert lv["unknown"]["time"] == "--" and lv["unknown"]["corners"] == "--"                       # unknown stays "--"
    assert not any("Fun " in (c["time"] or "") + (c["corners"] or "") for c in lv["cards"])          # never a Fun score


def test_a_level_not_looked_at_says_so_and_planning_shows_no_numbers(out):
    f = out["further"]
    assert [(c["label"], c["on"], c["further"]) for c in f] == [("Quick", False, False), ("Fun", True, False), ("Long way", False, True)]
    assert f[2]["time"] is None and f[2]["corners"] is None and f[0]["time"] == "50 min" and f[0]["corners"] == "4 corners"
    assert out["furtherNote"] == "Swipe the card for the next route, 2\u00a0of\u00a02"
    assert out["allSame"] == "All three pick the same route"
    assert [(c["on"], c["time"]) for c in out["planning"]] == [(False, "--"), (False, "--"), (True, "--")]


def test_the_card_says_the_ranked_swap_and_why(out):
    # finding 1: "Better route found: +8 min, 52 more corners", in the card's own numbers; the why line when they're equal
    assert out["swap"] == ["Better route found: +8 min, 52 more corners", "Better route found: 3 min quicker, 1 fewer corner",
                           "Better route found: avoids 2.2 mi of side streets", "Better route found"]


def test_twist_and_flow_come_from_the_geometry_of_any_track(out):
    g = out["gpxShape"]
    assert isinstance(g["twist"], (int, float)) and g["twist"] > 0 and isinstance(g["flow"], (int, float)) and g["flow"] > 0
    assert out["searchedShape"] == {"twist": 56, "flow": 23}                              # the searched route's own score first
    assert out["noShape"] == [{"twist": None, "flow": None}, {"twist": None, "flow": None}]


def test_facts_never_orphan_a_unit_and_a_cafe_is_a_cup(out):
    assert out["fact"] == "Ahead: Esses at 2.4 mi · Technical at 3.4 and 8.5 mi"      # U-134
    assert out["glyphs"] == ["cafe", "view", "fuel", "view"]
    html = open(os.path.join(ROOT, "web", "index.html")).read()
    assert '.f-along[data-glyph="cafe"]' in html and '.f-along[data-glyph="fuel"]' in html
