"""The route card as instruments (web/route_card.js, docs/design/REVIEW.md roadmap 5): three stamped numbers, the profile
with a tick per corner, half-dials and option tiles. Unknown stays "--"."""
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
  tiles: R.tiles([{ fun: { fun: 98 }, timeS: 10080 }, { fun: { fun: 80 }, timeS: 9360 }, { fun: { fun: 100 }, timeS: 12660 }, { fun: null, timeS: null }], 0),
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


def test_option_tiles_are_relative_to_the_pick(out):
    assert out["tiles"] == [{"title": "Fun 98 · 2:48", "sub": "this one"}, {"title": "Fun 80 · 2:36", "sub": "12 min quicker"},
                            {"title": "Fun 100 · 3:31", "sub": "+43 min"}, {"title": "Fun -- · --", "sub": "--"}]


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
