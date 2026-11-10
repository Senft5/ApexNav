"""What this drive is like (web/route_story.js): a planned route in a few plain lines from what the route engine already
holds for it. Synthetic routes ranked by the real engine: country, suburban and mixed; a highlight with its road names;
thin data saying less; unknown data never making a claim (CLAUDE.md rule 3)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const path = require('path'), ROOT = process.argv[1];
const Core = require(path.join(ROOT, 'web/apex_core.js')); globalThis.ApexCore = Core;
globalThis.ApexSun = require(path.join(ROOT, 'web/sun.js'));
const FunRoute = require(path.join(ROOT, 'web/fun_route.js')); globalThis.ApexFunRoute = FunRoute;
const Ctx = require(path.join(ROOT, 'web/route_ctx/registry.js'));
const Engine = require(path.join(ROOT, 'web/route_engine.js'));
const Story = require(path.join(ROOT, 'web/route_story.js'));

// A road heading east, km long; twisty (a sine of heading, 40-60 m radius) between twist[0] and twist[1] km
function road(km, twist) {
  const coords = [[-84.6, 39.2]];
  let lat = 39.2, lon = -84.6;
  for (let s = 5; s <= km * 1000; s += 5) {
    const x = s - (twist ? twist[0] * 1000 : 0), h = twist && s >= twist[0] * 1000 && s <= twist[1] * 1000 ? (x % 1000 < 750 ? 0.7 : 1.15) * Math.sin(2 * Math.PI * x / 250) : 0;
    lat += 5 * Math.sin(h) / 110540; lon += 5 * Math.cos(h) / (111320 * Math.cos(39.2 * Math.PI / 180));
    coords.push([lon, lat]);
  }
  return coords;
}
// channels: name -> fn(km along) (NaN for unknown); spans / points as the providers give them
function cand(km, twist, channels, o = {}) {
  const coords = road(km, twist);
  const c = { route: { coords }, timeS: km * 60, label: o.label || 'c' };
  c.t = FunRoute.geometry(coords, Core);
  c.fun = FunRoute.score(c.t, [], null);
  c.corridor = Ctx.corridor(c.label, coords, { timeS: c.timeS, departAt: Date.parse('2026-11-09T22:30:00Z') });
  const n = c.corridor.distM.length, ch = {};
  for (const [k, f] of Object.entries(channels)) ch[k] = Float32Array.from({ length: n }, (_, i) => { const v = f(c.corridor.distM[i] / 1000); return v == null ? NaN : v; });
  c.ctx = { channels: ch, spans: o.spans || [], points: (o.points || []) };
  return c;
}
const rank = (c) => Engine.rank([c], { level: 'fun', score: (x, scaleAt) => FunRoute.score(x.t, [], null, scaleAt), fresh: true })[0];
const dump = process.env.STORY_DUMP;
const story = (c, o = {}) => Story.build(rank(c), { metric: false, ...o });
const NaN_ = () => NaN;
const between = (a, b, v, w = NaN) => (k) => (k >= a && k < b ? v : w);

const country = {
  // the twisty middle (3-8 km) a quiet back road; either side a busy one (a driveway every 25 m, 15 000 a day)
  road_class: () => 4, lanes: () => 1, speed_limit_kph: (k) => (k < 3 || k > 8 ? 56 : k < 5 ? 88.5 : 80.5), density: () => 1, access_per_km: (k) => (k < 3 || k > 8 ? 40 : 4), aadt: (k) => (k < 3 || k > 8 ? 15000 : 600), housing_per_km2: () => 15, impervious_pct: () => 2,
  address_per_km: () => 3, business_per_km: () => 0, canopy_pct: () => 65, open_country: (k) => (k < 6 ? 0.7 : 0.2), signals_per_km: () => 0,
  stops_per_km: (k) => (k < 3 || k > 8 ? 1.5 : 0),
};
const countryWet = { ...country, crowd_rough_g: between(5, 10, 0.06), crowd_flow: between(5, 10, 0.82), crowd_bank_deg: NaN_, loved: NaN_,
  precip_6h_mm: () => 3, deer_risk: () => 4, deer_time_risk: () => 1, light: () => 0 };
const steps = [{ m: 0, street: 'Struble Road' }, { m: 5000, street: 'Day Road' }];
const out = {};
out.country = story(cand(10, [3, 8], countryWet), { steps });
out.countryKm = story(cand(10, [3, 8], countryWet), { steps, metric: true });
out.noNames = story(cand(10, [3, 8], country));
const suburb = { road_class: () => 6, speed_limit_kph: () => 56, density: () => 6, housing_per_km2: () => 900, sidewalk: () => 1, address_per_km: () => 60,
  business_per_km: () => 1, signals_per_km: () => 1, impervious_pct: () => 30 };
const sigs = [500, 1300, 2100, 2900, 3700, 4500].map((m) => ({ kind: 'signal', atM: m }));
out.suburban = story(cand(6, null, suburb, { points: sigs }), { steps: [{ m: 0, street: 'Elm Street' }] });
// mixed: 5 km of town with shops and lights, then 7 km of twisty country road
const mixed = {};
for (const k of Object.keys({ ...country, ...suburb })) mixed[k] = (km) => (km < 5 ? (k === 'business_per_km' ? 9 : k === 'speed_limit_kph' ? 56 : k in suburb ? suburb[k](km) : NaN) : (k in country ? country[k](km) : NaN));
out.mixed = story(cand(10, [4.5, 9], mixed, { points: [400, 1100, 1900, 2600].map((m) => ({ kind: 'signal', atM: m })) }), { steps: [{ m: 0, street: 'Main Street' }, { m: 3000, street: 'Blue Rock Road' }] });
// thin: only the road class, known on a third of it
out.thin = story(cand(10, [3, 8], { road_class: between(0, 3.3, 4), speed_limit_kph: between(0, 3.3, 88) }), { steps });
// unknown: every channel present and every value unknown (NaN), crowd and conditions included
const unknown = {};
for (const k of Object.keys(countryWet)) unknown[k] = NaN_;
out.unknown = story(cand(10, [3, 8], unknown), { steps });
// country known, land cover unknown: no "through woods"; crowd known on 300 m only: no members' line
out.noCover = story(cand(10, [3, 8], { ...country, canopy_pct: NaN_, open_country: NaN_, crowd_rough_g: between(6, 6.3, 0.05) }), { steps });
// glare and a closure the engine knows about
out.glare = story(cand(10, [3, 8], country, { spans: [{ kind: 'closure', fromM: 7000, toM: 7100 }] }), { steps, glareMin: 7 });
// a class estimate is not a limit: no speed said; the good road the whole way says so
out.estimate = story(cand(10, [0.5, 9.5], { ...country, speed_limit_kph: NaN_, speed_limit_est_kph: () => 88, stops_per_km: () => 0, access_per_km: () => 4, aadt: () => 600 }), { steps });
// members measured 2 km with no street names known
out.crowdNoName = story(cand(10, [3, 8], { ...country, crowd_rough_g: between(4, 6, 0.3) }));
// fitted on the public Cincinnati trips (2026-11-09): two lanes each way is not a two-lane road; a city's glow over open
// ground is not suburbs; a best part over five roads names none as the whole of it; houses beside good road aren't slow
out.fourLane = story(cand(10, [3, 8], { ...country, lanes: () => 2 }), { steps });
out.glow = story(cand(10, [3, 8], { ...country, night_lights: () => 0.6 }), { steps });
out.oneSignal = Story.settings({ channels: { night_lights: Float32Array.from({ length: 8 }, () => 0.9), road_class: Float32Array.from({ length: 8 }, () => 4) } }, 8);
const five = ['Willey Road', 'Paddys Run Road', 'Morgan Ross Road', 'Brookville Road', 'Shandon Road'].map((street, k) => ({ m: 3000 + k * 1000, street }));
out.manyRoads = story(cand(10, [3, 8], country), { steps: [{ m: 0, street: 'Start Road' }, ...five, { m: 8000, street: 'End Road' }] });
out.manyRoadsAll = story(cand(10, [0.5, 9.5], { ...country, stops_per_km: () => 0, access_per_km: () => 4, aadt: () => 600 }), { steps: [{ m: 0, street: 'Start Road' }, ...five.map((x, k) => ({ ...x, m: 500 + k * 1800 }))] });
out.hamlet = story(cand(10, [0.5, 9.5], { ...country, stops_per_km: () => 0, access_per_km: () => 4, aadt: () => 600, address_per_km: between(4, 6, 35, 3), bldg_per_km: between(4, 6, 40, 5) }), { steps });
out.none = [Story.build(null), Story.build({}), Story.build({ corridor: null, ctx: null })];
out.words = { dist: [Story.dist(800, false), Story.dist(2400, false), Story.dist(9700, false), Story.dist(1609, false), Story.dist(4200, true)],
  names: [Story.roadNames(['Struble Road', 'Day Road']), Story.roadNames(['Struble Road', 'Day Lane']), Story.roadNames(['US 27', 'Day Road'])] };
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def texts(s):
    return [x["text"] for x in s["lines"]]


def kinds(s):
    return [x["kind"] for x in s["lines"]]


JARGON = ("goodness", " G ", "quality", "NaN", "undefined", "null", "Infinity")


def plain(s):
    for t in texts(s):
        assert not any(j in t for j in JARGON), t
        assert (t[0].isupper() or t[0].isdigit()) and t.endswith("."), t


def test_country_route_reads_as_a_driver_says_it(out):
    s = out["country"]
    plain(s)
    assert kinds(s) == ["character", "highlight", "members", "conditions"], texts(s)
    lead, hl, members, cond = texts(s)
    assert lead.startswith("Mostly two-lane country roads through ") and "woods" in lead and "farmland" in lead, lead
    assert lead.endswith("35–50 mph."), lead        # the posted limits, quartiles
    # the highlight: the twisty 5 km on both named roads, its corners counted from the track
    assert hl.startswith("The best part is ") and "of Struble and Day Road: " in hl and "good corners" in hl, hl
    f = s["lines"][1]["facts"]
    assert f["names"] == ["Struble Road", "Day Road"] and f["corners"]["n"] >= 30 and f["corners"]["tight"] >= 3 and 4000 <= f["m"] <= 6000, f
    assert hl.endswith("good corners, five of them tight."), hl
    assert members == "Members' drives say Day Road is smooth and flows well.", members
    assert cond.startswith("Wet roads") and "deer likely" in cond and cond.endswith(" after dark."), cond
    assert 3 <= len(s["lines"]) <= 5


def test_units_follow_the_setting(out):
    s = out["countryKm"]
    assert texts(s)[0].endswith("55–80 km/h."), texts(s)
    assert " km of " in texts(s)[1] and "mile" not in " ".join(texts(s)), texts(s)
    assert out["words"]["dist"] == ["0.5 miles", "1.5 miles", "6 miles", "1 mile", "4 km"]


def test_highlight_without_names_says_where_it_starts(out):
    hl = [x for x in out["noNames"]["lines"] if x["kind"] == "highlight"]
    assert hl and "of good road, starting " in hl[0]["text"] and " in: " in hl[0]["text"], hl
    assert hl[0]["facts"]["names"] == []


def test_road_names_join_as_said(out):
    assert out["words"]["names"] == ["Struble and Day Road", "Struble Road and Day Lane", "US 27 and Day Road"]


def test_suburban_route(out):
    s = out["suburban"]
    plain(s)
    assert texts(s)[0] == "Mostly suburban roads, 35 mph.", texts(s)
    assert "highlight" not in kinds(s), texts(s)                      # nothing good enough to call the best part
    slow = [x for x in s["lines"] if x["kind"] == "slow"]
    assert slow and slow[0]["text"] == "6 sets of lights on the way.", slow


def test_mixed_route_names_the_town_at_the_start(out):
    s = out["mixed"]
    plain(s)
    lead = texts(s)[0]
    assert lead.startswith("A mix of country roads and town"), lead
    hl = [x for x in s["lines"] if x["kind"] == "highlight"][0]
    assert "Blue Rock Road" in hl["text"] and hl["facts"]["fromM"] >= 4900, hl
    slow = [x for x in s["lines"] if x["kind"] == "slow"][0]
    assert slow["text"] == "About 3 miles through town at the start, with 4 sets of lights.", slow
    assert kinds(s).index("highlight") < kinds(s).index("slow")


def test_thin_data_says_less(out):
    s = out["thin"]
    assert len(s["lines"]) <= 1, texts(s)
    assert "character" not in kinds(s) or texts(s)[0].startswith("Limits"), texts(s)
    assert "highlight" not in kinds(s), texts(s)
    assert s["coverage"]["setting"] < 0.6


def test_unknown_never_makes_a_claim(out):
    assert out["unknown"]["lines"] == [], texts(out["unknown"])
    for s in out["none"]:
        assert s["lines"] == []
    s = out["noCover"]
    assert not any("woods" in t or "farmland" in t or "water" in t for t in texts(s)), texts(s)
    assert "members" not in kinds(s), texts(s)                         # 300 m measured is not enough to speak for a road
    assert "conditions" not in kinds(s), texts(s)                      # no weather, deer or light channels: nothing said


def test_live_conditions_only_when_real(out):
    cond = [x for x in out["glare"]["lines"] if x["kind"] == "conditions"]
    assert cond and cond[0]["text"] == "A closure on the way and low sun for 7 min.", cond
    assert "conditions" not in kinds(out["suburban"])


def test_an_estimated_limit_is_never_said(out):
    s = out["estimate"]
    assert not any("mph" in t for t in texts(s)), texts(s)
    assert texts(s)[1].startswith("Good road nearly all the way on Struble and Day Road: "), texts(s)


def test_members_without_names(out):
    m = [x for x in out["crowdNoName"]["lines"] if x["kind"] == "members"]
    assert m and m[0]["text"] == "Members' drives say the 1 mile they've measured is rough.", m


def test_two_lanes_each_way_is_not_a_two_lane_road(out):
    """`lanes` is lanes in your direction (route_ctx/router_edges.js, the tiles, HPMS halved): 1 is the two-lane road."""
    assert texts(out["country"])[0].startswith("Mostly two-lane country roads"), texts(out["country"])
    lead = texts(out["fourLane"])[0]
    assert lead.startswith("Mostly country roads through ") and "two-lane" not in lead, lead


def test_one_signal_never_makes_open_ground_suburbs(out):
    """Night lights glow well past a city's edge (the public Harrison trip read 10 of its 19 country miles as suburbs on
    them alone): with every other place signal saying open ground the road is country. Alone, a signal can say built but
    the ground is never called country on one signal."""
    lead = texts(out["glow"])[0]
    assert lead.startswith("Mostly two-lane country roads"), lead
    assert not any(x["kind"] == "slow" for x in out["glow"]["lines"]), texts(out["glow"])
    assert set(out["oneSignal"]) == {"suburban"}, out["oneSignal"]


def test_a_best_part_over_many_roads_names_none_as_the_whole(out):
    """5 km of good road over five roads of 1 km each (the public Oxford trip said "7 miles of Millville Shandon Road" of a
    stretch that road carried 3 miles of): "of good road, including" its two longest, never "3 miles of X". Nearly all
    the way over many roads: no road named as the whole of it."""
    hl = [x for x in out["manyRoads"]["lines"] if x["kind"] == "highlight"][0]
    f = hl["facts"]
    assert f["namesWhole"] is False and len(f["names"]) == 2 and 4000 <= f["m"] <= 6000, f
    assert hl["text"].startswith("The best part is 3 miles of good road, including ") and " and " in hl["text"], hl["text"]
    assert all(n in ("Willey Road", "Paddys Run Road", "Morgan Ross Road", "Brookville Road", "Shandon Road") for n in f["names"]), f
    al = [x for x in out["manyRoadsAll"]["lines"] if x["kind"] == "highlight"][0]
    assert al["text"].startswith("Good road nearly all the way: "), al["text"]
    assert out["country"]["lines"][1]["facts"]["namesWhole"] is True       # two roads carrying it all: named as before


def test_houses_beside_good_road_are_not_a_slow_part(out):
    """2 km of a good road with houses along it (a hamlet): the lead may count it, the slow line doesn't call it suburbs."""
    s = out["hamlet"]
    built = sum(1 for x in s["lines"] if x["kind"] == "slow")
    assert built == 0, texts(s)
    assert any(x["kind"] == "highlight" for x in s["lines"]), texts(s)
