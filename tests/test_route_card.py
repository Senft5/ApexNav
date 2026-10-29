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
