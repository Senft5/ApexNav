"""What the car's screen is told (web/carplay.js, CarPlay/ApexCarPlay.swift): the route line, up to three choices, the
next maneuver with distances, and recent places; nothing invented when a value is unknown."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const C = require(process.argv[1] + '/web/carplay.js'), D = require(process.argv[1] + '/web/directions.js');
const n = 1001, t = { id: 'route_dest', name: 'To Robbinsville', lat: [], lon: [], dist: [], timeS: 4620, fun: { fun: 99 },
  steps: [{ m: 1200, type: 15, street: 'Deals Gap Road' }, { m: 3000, type: 8 }, { m: 4990, type: 4 }] };
for (let i = 0; i < n; i++) { t.lat.push(35.3 + i * 5 / 110540); t.lon.push(-83.8); t.dist.push(i * 5); }
const opts = [{ fun: { fun: 99 }, timeS: 4620, distM: null }, { fun: { fun: 40 }, timeS: 3900, distM: 70000 }];
console.log(JSON.stringify({
  line: C.line(t).length, ends: [C.line(t)[0], C.line(t).slice(-1)[0]],
  one: C.routeMessage(t, null, 0, (m) => `${(m / 1609.344).toFixed(1)} mi`),
  two: C.routeMessage(t, opts, 1, null),
  none: C.routeMessage({ lat: [1], lon: [1], dist: [0] }, null, 0),
  g0: C.guideMessage(t, 100, 3600, D.phrase), g1: C.guideMessage(t, 1300, null, D.phrase), g2: C.guideMessage(t, 4995, 0, D.phrase),
  // corners interleaved with turns: an R5 at 300 m, an L2 at 700 m, a corner on the turn at 1190 m, a hairpin past it
  ...(() => { const c = { ...t, events: [
    { type: 'corner', dir: 'R', severity: 5, start_m: 300, dist_m: 340, call: 'Right 5 long' },
    { type: 'corner', dir: 'L', severity: '2', start_m: 700, dist_m: 730, call: 'Left 2 tightens' },
    { type: 'corner', dir: 'L', severity: 3, start_m: 1190, dist_m: 1210, call: 'Left 3' },
    { type: 'corner', dir: 'R', severity: 'HP', start_m: 1500, dist_m: 1530, call: 'Right hairpin' },
    { type: 'corner', dir: 'R', severity: null, start_m: 1600, dist_m: 1610 }, { type: 'crest', start_m: 200, dist_m: 200 }] };
    return {
      c0: C.guideMessage(c, 100, 3600, D.phrase), c1: C.guideMessage(c, 400, 3600, D.phrase), c2: C.guideMessage(c, 800, null, D.phrase),
      c3: C.guideMessage(c, 1300, null, D.phrase), tight: C.guideMessage(c, 100, null, D.phrase, { corners: 'tight' }),
      off: C.guideMessage(c, 100, null, D.phrase, { corners: 'off' }), plain: C.guideMessage(c, 100, null, D.phrase, { call: (e) => 'plain ' + e.dir }),
      tulips2: [1, 4, 6, 'HP'].map((v) => C.cornerTulipSVG('L', v, '#7DF5DE')).concat([C.cornerTulipSVG('R', 3, 'red;x')]) }; })(),
  sight: [C.sightMessage(52.4, false, 40, 'mph'), C.sightMessage(30, false, 45.5, 'km/h'), C.sightMessage(30, true, 99, 'mph'), C.sightMessage(null, false, 40, 'mph'), C.sightMessage(NaN, false, 1, 'mph')],
  places: C.placesMessage([{ label: 'Home', lat: 35.1, lon: -83.2 }, { label: 'Bad', lat: null, lon: 1 }, null]),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_route_line_is_small_and_keeps_both_ends(out):
    assert out["line"] <= 401
    assert out["ends"] == [[35.3, -83.8], [round(35.3 + 1000 * 5 / 110540, 6), -83.8]]


def test_route_choices(out):
    one = out["one"]
    assert one["kind"] == "route" and one["name"] == "To Robbinsville" and one["picked"] == 0
    # one route: the card's title is its name and the car prints time and length, so the summary is the Fun score
    assert one["options"] == [{"summary": "Fun 99", "detail": "3.1 mi", "timeS": 4620, "distM": 5000}]
    two = out["two"]
    assert [o["summary"] for o in two["options"]] == ["Fun 99 · 77 min", "Fun 40 · 65 min"] and two["picked"] == 1
    assert two["options"][0]["distM"] is None, "an option not built yet has no known length"
    assert out["none"] is None


def test_next_maneuver(out):
    assert out["g0"] == {"kind": "guide", "key": "route_dest:1200", "instruction": "Turn left onto Deals Gap Road", "street": "Deals Gap Road",
                         "type": 15, "distM": 1100, "remainM": 4900, "remainS": 3600}
    assert out["g1"]["instruction"] == "Arriving at your destination", "a step that isn't said (continue) is skipped"
    assert out["g1"]["remainS"] is None, "unknown time stays unknown"
    assert out["g2"] is None or out["g2"]["distM"] == 0


def test_places(out):
    assert out["places"] == {"kind": "places", "list": [{"name": "Home", "at": [35.1, -83.2]}]}


def test_only_road_hazards_alert_the_car():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert "if (text && opts.alert && driveActive) carPost({ kind: 'hazard'" in html
    # the urgent speech lane also carries turn-now directions and crests: only member, reported and convoy hazards set alert
    assert html.count("alert: true") == 3


MAPRUN = r"""
const C = require(process.argv[1] + '/web/carplay.js');
const t = { events: [{ type: 'corner', dir: 'L', severity: 4, lat: 35.1, lon: -83.9 }, { type: 'corner', dir: 'R', severity: 'HP', dist_m: 500 },
  { type: 'corner', dir: 'R', severity: 2, dist_m: 900 }, { type: 'bump', dist_m: 100 }, { type: 'corner', dir: 'R', severity: 3 }] };
const at = (m) => ({ lat: 35 + m / 1e5, lon: -84 });
console.log(JSON.stringify({
  corners: C.cornersMessage(t, at), none: C.cornersMessage(null, at),
  hazards: C.hazardsMessage([{ id: 7, kind: 'gravel', lat: 35.2, lon: -83.5 }, { id: 8, label: 'Cattle grid', lat: 35, lon: -83 }, { id: 9, kind: 'x' }], { gravel: 'Gravel' }),
  look: C.lookMessage({ id: 'tapedeck', night: { panel: '#0A0C0B', panelInk: '#7DF5DE', accent: '#FFB347' } }, false),
  tulips: [10, 15, 17, 12, 4, 26].map((k) => C.tulipSVG(k, '#7DF5DE')), bad: C.tulipSVG(10, 'red;x'),
  withCorners: C.routeMessage({ lat: [35, 35.01], lon: [-84, -84], dist: [0, 1100], timeS: 120, events: t.events }, null, 0, (m) => `${m} m`).options[0],
  loop: C.routeMessage({ name: '32 min loop', lat: [35, 35.01], lon: [-84, -84], dist: [0, 15630], timeS: 1920, events: t.events }, null, 0, (m) => `${m} m`).options[0],
  metricLook: C.lookMessage({ id: 'roadbook' }, true, 'metric').units,
}));
"""


@pytest.fixture(scope="module")
def maps():
    return json.loads(subprocess.run([NODE, "-e", MAPRUN, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_cars_map_gets_every_rated_corner_at_its_apex(maps):
    # a corner with no position of its own is placed along the route; one with neither, or no direction, is left out
    assert maps["corners"]["list"] == [
        {"at": [35.1, -83.9], "text": "L4", "tight": False},
        {"at": [35.005, -84], "text": "RHP", "tight": True},
        {"at": [35.009, -84], "text": "R2", "tight": True},
    ]
    assert maps["none"]["list"] == []


def test_hazards_are_named_and_unplaceable_ones_dropped(maps):
    assert maps["hazards"]["list"] == [{"id": "7", "at": [35.2, -83.5], "title": "Gravel"}, {"id": "8", "at": [35, -83], "title": "Cattle grid"}]


def test_the_look_carries_the_theme_and_its_dark_card(maps):
    assert maps["look"] == {"kind": "look", "theme": "tapedeck", "card": "#0A0C0B", "cardInk": "#7DF5DE", "accent": "#FFB347", "voice": False,
                            "units": "imperial"}


def test_turn_symbols_are_tulips_in_the_cards_ink_and_never_take_markup(maps):
    assert all(s.startswith("<svg") and 'stroke="#7DF5DE"' in s for s in maps["tulips"])
    assert len(set(maps["tulips"])) == len(maps["tulips"])          # each turn draws differently
    assert "red;x" not in maps["bad"] and 'stroke="#EDE4D3"' in maps["bad"]


def test_a_route_choice_says_its_distance_and_corners(maps):
    # no Fun score: the corners are the summary (every corner counts, placeable on the map or not), the length the detail
    assert maps["withCorners"]["summary"] == "4 corners" and maps["withCorners"]["detail"] == "1100 m"
    # the owner's car showed "32 min loop" twice: nothing in the summary repeats the name or the time the car prints
    assert "min" not in maps["loop"]["summary"] and "loop" not in maps["loop"]["summary"]
    assert maps["metricLook"] == "metric"


def test_corners_come_before_the_next_turn(out):
    """Every corner is guidance too (the owner, 2026-10-29): whichever is first, the next corner or the next turn."""
    c0 = out["c0"]
    assert c0["key"] == "route_dest:c300" and c0["instruction"] == "Right 5 long" and c0["street"] == "R5"
    assert c0["distM"] == 200 and c0["corner"] == {"dir": "R", "sev": 5} and c0["type"] == 9 and c0["remainS"] == 3600
    assert out["c1"]["corner"] == {"dir": "L", "sev": 2} and out["c1"]["type"] == 14, "a 2 shows as a sharp bend"
    assert out["c2"]["key"] == "route_dest:1200" and "corner" not in out["c2"], "a corner on the turn is the turn"
    assert out["c3"]["corner"] == {"dir": "R", "sev": "HP"} and out["c3"]["type"] == 12
    assert out["c3"]["distM"] == 200


def test_corner_modes_and_words(out):
    assert out["tight"]["key"] == "route_dest:c700", "tight only (the App Review fallback) skips the 5"
    assert out["off"]["key"] == "route_dest:1200" and "corner" not in out["off"]
    assert out["plain"]["instruction"] == "plain R", "worded as the phone words it"


def test_corner_tulips(out):
    svgs = out["tulips2"]
    assert len(set(svgs[:4])) == 4, "each rating bends differently"
    assert all(s.startswith("<svg") and "#7DF5DE" in s and "<circle" not in s for s in svgs[:4]), "no junction dot: a corner is not a turn"
    assert "red;x" not in svgs[4] and "#EDE4D3" in svgs[4]


def test_sight_tag(out):
    """The sight-line speed on the arrow: the number in the chosen units, OPEN, red when faster, hidden when unknown."""
    a, b, o, n, nan = out["sight"]
    assert a == {"kind": "sight", "text": "52", "unit": "MPH", "short": False}
    assert b == {"kind": "sight", "text": "30", "unit": "KM/H", "short": True}
    assert o == {"kind": "sight", "text": "OPEN", "unit": "", "short": False}
    assert n["text"] is None and nan["text"] is None, "unknown stays unknown"


def test_car_map_fills_the_screen_at_its_own_scale():
    """The owner's photos (2026-10-30): the map stopped at the map buttons, and plates and labels came out giant and soft."""
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    html = open(os.path.join(ROOT, "web", "carmap.html"), encoding="utf-8").read()
    assert "contentInsetAdjustmentBehavior = .never" in swift and "viewport-fit=cover" in html
    assert "func fitViewport()" in swift and "'width=\\(w), initial-scale=1" in swift, "laid out at the car's width, not the phone's"


def test_opens_with_no_route():
    """Opening the app (or the car) starts with no route: the planned route lasts the session only (2026-10-30)."""
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert "sessionStorage.setItem(PLANNED" in html and "localStorage.setItem(PLANNED" not in html
    assert "localStorage.getItem(PLANNED)" not in html
    # ... but a route being driven survives a close, and ending the drive forgets it (the owner: "active routes")
    assert "if (track && track.kind === 'route') persistActive(track);" in html
    assert "forgetActive();                                                  // the drive is over" in html
    assert "localStorage.getItem(ACTIVE)" in html and "ACTIVE_KEEP_MS" in html
