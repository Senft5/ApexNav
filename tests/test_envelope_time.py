"""A time for a route the router never timed (web/eta.js envelopeTime, docs/design/REVIEW4.md U-64): from the route's own
speed envelope, capped by the posted limits where known; a forecast like a router's ETA, and the page labels nothing
"with traffic"."""
import json
import os
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const E = require(process.argv[1] + '/web/eta.js');
const n = 2001, dist = Array.from({ length: n }, (_, i) => i * 5);            // 10 km in 5 m samples
const fast = dist.map(() => 40), limits = dist.map((_, i) => (i < 1000 ? 20 : null));
// a slow first half (a twisty 10 m/s), a fast second
const twisty = dist.map((_, i) => (i < 1000 ? 10 / 0.92 : 40));
const t = E.envelopeTime(dist, twisty, null);
console.log(JSON.stringify({
  open: E.envelopeTime(dist, fast, null).timeS,
  capped: E.envelopeTime(dist, fast, limits).timeS,
  twisty: t.timeS, marks: t.marks.length, mid: E.routerLeft(5000, 10000, t.timeS, t.marks),
  increasing: t.marks.every((m, i) => i === 0 || (m[0] > t.marks[i - 1][0] && m[1] >= t.marks[i - 1][1])),
  hole: E.envelopeTime(dist, dist.map((_, i) => (i === 7 ? null : 0)), null).timeS,
  none: [E.envelopeTime(null, fast), E.envelopeTime([0], [1]), E.envelopeTime(dist, fast.slice(1)), E.envelopeTime([0, 0], [1, 1]), E.envelopeTime([0, 5, 3], [9, 9, 9])],
}));
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_unknown_limit_caps_at_the_replay_pace(out):
    assert out["open"] == pytest.approx(10000 / 27, rel=1e-6)          # an envelope of 40 m/s is capped at about 60 mph


def test_posted_limits_cap_where_known(out):
    # 5 km at 20 m/s (the limit), then 5 km at the no-limit 27 m/s; the joining segment averages the two
    assert out["capped"] == pytest.approx(4995 / 20 + 4995 / 27 + 10 / 23.5, rel=1e-3)


def test_the_slow_miles_are_placed_where_they_are(out):
    assert out["twisty"] == pytest.approx(5000 / 10 + 5000 / 27, rel=0.01)
    assert out["marks"] >= 30 and out["increasing"]
    # halfway along, only the fast half is left: routerLeft follows the marks, not an even spread
    assert out["mid"] == pytest.approx(5000 / 27, rel=0.02)


def test_never_stalls_on_a_zero_or_missing_envelope(out):
    assert out["hole"] == pytest.approx(10000 / 4, rel=0.01)            # 0 m/s floors at 4 m/s; a gap uses the cap


def test_untimeable_tracks_stay_unknown(out):
    assert out["none"] == [None] * 5


def test_the_page_times_untimed_routes_and_says_nothing_of_traffic():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    build = re.search(r"async function buildRoute\(.*?\n    }", html, re.S).group(0)
    assert "timeFromEnvelope(t);" in build                                # every route the page builds, GPX and loops too
    assert "ApexEta.envelopeTime(t.dist, t.envMps, t.limitMps)" in html
    assert "if (timeFromEnvelope(t) && plannedRoute === t) renderRouteCard(t);" in html   # again once the limits arrive
    assert "routeTimeText(t.timeS)" in html and "with traffic" not in html.lower()
