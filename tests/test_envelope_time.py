"""A time for a route the router never timed (web/eta.js envelopeTime, docs/design/REVIEW4.md U-64): from the route's own
speed envelope, capped by the posted limits where known; a forecast like a router's ETA, and the page labels nothing
"with traffic". U-97 (REVIEW4_CHECK.md): fitted to the recorded drive, web/data/dry_ridge.js, within 3% of its time."""
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
const K = E.ENVELOPE;
const n = 2001, dist = Array.from({ length: n }, (_, i) => i * 5);            // 10 km in 5 m samples
const fast = dist.map(() => 40);
const highway = dist.map((_, i) => (i < 1000 ? 29 : null));                    // 65 mph, then a road with no posted limit
const town = dist.map(() => 35 / 2.2369362921), fifty = dist.map(() => 50 / 2.2369362921);
// a slow first half (a twisty 10 m/s), a fast second
const twisty = dist.map((_, i) => (i < 1000 ? 10 / K.ENVELOPE_SHARE : 40));
const t = E.envelopeTime(dist, twisty, null);
console.log(JSON.stringify({ K,
  open: E.envelopeTime(dist, fast, null).timeS,
  capped: E.envelopeTime(dist, fast, highway).timeS,
  town: E.envelopeTime(dist, fast, town).timeS, fifty: E.envelopeTime(dist, fast, fifty).timeS,
  twisty: t.timeS, marks: t.marks.length, mid: E.routerLeft(5000, 10000, t.timeS, t.marks),
  increasing: t.marks.every((m, i) => i === 0 || (m[0] > t.marks[i - 1][0] && m[1] >= t.marks[i - 1][1])),
  hole: E.envelopeTime(dist, dist.map((_, i) => (i === 7 ? null : 0)), null).timeS,
  none: [E.envelopeTime(null, fast), E.envelopeTime([0], [1]), E.envelopeTime(dist, fast.slice(1)), E.envelopeTime([0, 0], [1, 1]), E.envelopeTime([0, 5, 3], [9, 9, 9])],
}));
"""

# U-97: the recorded drive (web/data/dry_ridge.js, 35.6 mi: town, 23 mi of interstate at 65 to 70, Dry Ridge's back roads),
# its line analysed the way the page analyses a route (analysis_client.js runInline, no sight offsets), its limits as
# attachLimits gives them (an array, null where the road has none posted), against the time it actually took
# (Core.elapsedS of its own speeds, the time the Log shows).
CALIBRATE = r"""
const root = process.argv[1];
globalThis.window = globalThis;
const Core = globalThis.ApexCore = require(root + '/web/apex_core.js');
const A = require(root + '/web/analysis_client.js'), E = require(root + '/web/eta.js');
require(root + '/web/data/dry_ridge.js');
const src = window.APEX_DRIVES[0], f = src.fields, c = (k) => f.indexOf(k);
const rows = src.rows, lat = rows.map((r) => r[c('lat')]), lon = rows.map((r) => r[c('lon')]);
const v = rows.map((r) => r[c('speed_mph')] / 2.2369362921);
const lim = rows.map((r) => (r[c('limit_kph')] == null ? null : r[c('limit_kph')] / 3.6));
const rs = Core.resamplePolyline(lat, lon, 5), env = Array.from(A.runInline(Core, rs.lat, rs.lon, null, 'right').env);
const dist = rs.lat.map((_, i) => i * 5), limits = rs.lat.map((_, i) => lim[Math.min(lim.length - 1, i)]);
const T = Core.elapsedS(v), back = (i) => !(lim[i] >= E.ENVELOPE.OPEN_LIMIT_MPS);
// the back roads alone (no posted limit, or town): the stretch the first forecast missed by 40%
const part = (keep) => { let real = 0, fc = 0; const e = rs.lat.map((_, i) => (keep(i) ? 1 : 0));
  for (let i = 1; i < Math.min(v.length, dist.length); i++) if (e[i]) { real += T[i] - T[i - 1]; fc += 10 / (vAt(i) + vAt(i - 1)); } return fc / real; };
const one = E.envelopeTime(dist, env, limits);
// the forecast's own speed per sample, from its marks: not exposed, so time each sample alone
const vAt = (i) => { const d2 = [0, 5], r = E.envelopeTime(d2, [env[i], env[i]], [limits[i], limits[i]]); return 5 / r.timeS; };
console.log(JSON.stringify({ real: T[T.length - 1], forecast: one.timeS, offline: E.envelopeTime(dist, env, null).timeS,
  back: part(back), highway: part((i) => !back(i)), miles: dist[dist.length - 1] / 1609.344 }));
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


@pytest.fixture(scope="module")
def drive():
    r = subprocess.run([NODE, "-e", CALIBRATE, ROOT], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_the_recorded_drive_is_forecast_within_three_percent(drive):
    # U-97: the first forecast said 36.8 min for the 46.0 min this drive took (and 25 for the reviewed 23 miles)
    assert drive["miles"] == pytest.approx(35.5, abs=0.5)
    assert drive["forecast"] == pytest.approx(drive["real"], rel=0.03), (drive["forecast"] / 60, drive["real"] / 60)


def test_each_kind_of_road_is_close_too(drive):
    # not one error cancelling another: the back roads and the interstate are each within 5%
    assert drive["back"] == pytest.approx(1, abs=0.05)
    assert drive["highway"] == pytest.approx(1, abs=0.05)


def test_limits_not_yet_looked_up_stay_in_range(drive):
    # offline (no limits at all) the forecast can't tell a back road from the interstate: within 10%, not 20% short
    assert drive["offline"] == pytest.approx(drive["real"], rel=0.10)


def test_unknown_limits_cap_between_highway_and_minor_road(out):
    assert out["open"] == pytest.approx(10000 / out["K"]["UNKNOWN_MPS"], rel=1e-6)


def test_posted_limits_cap_where_known_and_unposted_roads_are_minor(out):
    # 5 km at the 65 mph limit, then 5 km of road with no limit posted (looked up, none): the minor road's pace
    u = out["K"]["UNPOSTED_MPS"]
    assert out["capped"] == pytest.approx(4995 / 29 + 4995 / u + 10 / ((29 + u) / 2), rel=1e-3)


def test_town_limits_are_driven_under(out):
    # 35 mph: lights and turns, a share of the limit; 50 mph between that and all of it
    t35 = 35 / 2.2369362921
    assert out["town"] == pytest.approx(10000 / (t35 * out["K"]["TOWN_SHARE"]), rel=1e-3)
    assert 10000 / (50 / 2.2369362921) < out["fifty"] < 10000 / (50 / 2.2369362921 * out["K"]["TOWN_SHARE"])


def test_the_slow_miles_are_placed_where_they_are(out):
    u = out["K"]["UNKNOWN_MPS"]
    assert out["twisty"] == pytest.approx(5000 / 10 + 5000 / u, rel=0.01)
    assert out["marks"] >= 30 and out["increasing"]
    # halfway along, only the fast half is left: routerLeft follows the marks, not an even spread
    assert out["mid"] == pytest.approx(5000 / u, rel=0.02)


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
