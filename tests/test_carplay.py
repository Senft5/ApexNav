"""What the car's screen is told (web/carplay.js, CarPlay/ApexCarPlay.swift): the route line, up to three choices, the
next maneuver with distances, and recent places; nothing invented when a value is unknown."""
import json
import os
import shutil
import subprocess

import pytest
from tests.page_source import cockpit_source

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
  loopNoSteps: C.guideMessage({ id: 'loop_30min', dist: [0, 2000], events: [{ type: 'corner', dir: 'R', severity: 3, start_m: 300, dist_m: 320, call: 'Right 3' }] }, 0, 600, D.phrase),
  places: C.placesMessage([{ label: 'Home', lat: 35.1, lon: -83.2 }, { label: 'Bad', lat: null, lon: 1 }, null]),
  arrive: C.guideMessage(t, 3100, null, D.phrase),
  // U-63: a GPX track on the motorway, its next corner 13 km on; the road named by the map under the car, or not at all
  ...(() => { const g = { id: 'gpx', dist: [0, 20000], events: [{ type: 'corner', dir: 'R', severity: 2, start_m: 13000, dist_m: 13040, call: 'Tight right' }] };
    let reads = 0;
    return {
      far: C.guideMessage(g, 0, null, D.phrase, { road: () => { reads++; return 'I-275 West'; } }),
      farLater: C.guideMessage(g, 5000, null, D.phrase, { road: 'I-275 West' }),
      farNoName: C.guideMessage(g, 0, null, D.phrase, { road: () => null }),
      near: C.guideMessage(g, 11500, null, D.phrase, { road: () => { reads++; return 'I-275 West'; } }),
      roadReads: reads,
      // standing still at the start: a corner 5 m ahead is the one the car is at; one already begun is behind the card
      still: C.guideMessage({ id: 's', dist: [0, 3000], events: [{ type: 'corner', dir: 'R', severity: 1, start_m: -3, dist_m: 20 },
        { type: 'corner', dir: 'R', severity: 1, start_m: 5, dist_m: 30, call: 'Very tight right' }, { type: 'corner', dir: 'L', severity: 3, start_m: 400, dist_m: 430, call: 'Left 3' }] }, 0, null, D.phrase, { speedMps: 0.4 }),
      moving: C.guideMessage({ id: 's', dist: [0, 3000], events: [{ type: 'corner', dir: 'R', severity: 1, start_m: -3, dist_m: 20 },
        { type: 'corner', dir: 'R', severity: 1, start_m: 5, dist_m: 30, call: 'Very tight right' }] }, 0, null, D.phrase, { speedMps: 9 }),
    }; })(),
  rec0: C.recordingMessage(0, (m) => `${(m / 1609.344).toFixed(1)} mi`), rec1: C.recordingMessage(6800, (m) => `${(m / 1609.344).toFixed(1)} mi`),
  recNull: C.recordingMessage(null, null),
  recordSvg: C.recordSVG('#7DF5DE', '#FFB347'), recordBad: C.recordSVG('red;x', 'url(x)'),
  hairpin: C.cornerTulipSVG('R', 'HP', '#EDE4D3'), hairpinL: C.cornerTulipSVG('L', 'HP', '#EDE4D3'), follow: C.tulipSVG(8, '#EDE4D3'),
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
    # one route: the card's title is its name and the car prints time and length, so the summary is the Fun score; the
    # card shows only the detail above its estimates, so that says what the route is too (U-89: "35.4 mi" twice, a blank middle)
    assert one["options"] == [{"summary": "Fun 99", "detail": "Fun 99", "timeS": 4620, "distM": 5000}]
    two = out["two"]
    assert [o["summary"] for o in two["options"]] == ["Fun 99 · 77 min", "Fun 40 · 65 min"] and two["picked"] == 1
    assert two["options"][0]["distM"] is None, "an option not built yet has no known length"
    assert out["none"] is None


def test_next_maneuver(out):
    assert out["g0"] == {"kind": "guide", "key": "route_dest:1200", "instruction": "Turn left onto Deals Gap Road", "street": "Deals Gap Road",
                         "type": 15, "distM": 1100, "remainM": 4900, "remainS": 3600}
    # 3.7 km to the next said step: a continue step on the road the route is on (the step before names it)
    assert out["g1"] == {"kind": "guide", "key": "route_dest:f4990:Deals Gap Road", "instruction": "Follow Deals Gap Road", "street": "Deals Gap Road",
                         "type": 8, "follow": True, "distM": 3690, "remainM": 3700, "remainS": None}, "unknown time stays unknown"
    assert out["arrive"]["instruction"] == "Arriving at your destination", "a step that isn't said (continue) is skipped"
    assert out["g2"] is None or out["g2"]["distM"] == 0


def test_a_far_corner_is_a_continue_step_until_near(out):
    """U-63: "13.1 mi · Tight right" sat on the car's card for seven minutes of motorway (REVIEW4.md, guided-drive car/04)."""
    far = out["far"]
    assert far["instruction"] == "Follow I-275 West" and far["street"] == "I-275 West" and far["type"] == 8 and far["follow"] is True
    assert far["distM"] == 13000 and "corner" not in far, "the distance is to the corner the step leads to"
    assert out["farLater"]["key"] == far["key"], "the same stretch keeps one key: the card is built once, its distance counts down"
    assert out["farNoName"]["instruction"] == "Follow the route" and out["farNoName"]["street"] == "", "no road name is invented"
    near = out["near"]
    assert near["corner"] == {"dir": "R", "sev": 2} and near["instruction"] == "Tight right" and near["distM"] == 1500
    assert out["roadReads"] == 1, "the map is read for a name only when a continue step needs one"


def test_no_corner_under_a_standing_car(out):
    """U-63: the start of a drive showed "0 ft · Very tight right, opens up" for the corner under the car."""
    assert out["still"]["key"] == "s:c400" and out["still"]["corner"] == {"dir": "L", "sev": 3}
    assert out["moving"]["key"] == "s:c5", "moving, the corner just ahead is the next maneuver; one already begun never is"


def test_a_free_drive_has_a_record_card(out):
    """U-59: a drive with no route on the car: recording, and the distance driven in its words, never as a distance to a turn."""
    assert out["rec0"] == {"kind": "guide", "key": "rec:", "instruction": "Recording · the road ahead", "street": "Recording", "type": 8, "recording": True}
    assert out["rec1"]["instruction"] == "Recording · 4.2 mi driven" and out["rec1"]["key"] == "rec:4.2 mi" and out["rec1"]["street"] == "4.2 mi driven"
    assert "distM" not in out["rec1"] and "distM" not in out["rec0"]
    assert out["recNull"]["instruction"] == "Recording · the road ahead", "unknown distance: nothing said about it"
    assert 'stroke="#7DF5DE"' in out["recordSvg"] and 'fill="#FFB347"' in out["recordSvg"]
    assert "red;x" not in out["recordBad"] and "url(" not in out["recordBad"]


def test_the_hairpin_reads_as_a_hairpin(out):
    """U-78: a stem, a wide turn and a return leg leaving at 45 degrees, a thinner line so the legs stay apart at 60 px."""
    import re
    for svg, s in ((out["hairpin"], 1), (out["hairpinL"], -1)):
        assert 'stroke-width="7"' in svg and " A20 20 " in svg
        m = re.search(r'd="M([\d.]+) 92 V40 A20 20 0 0 [01] ([\d.]+) 40 V([\d.]+) L([\d.]+) ([\d.]+)"', svg)
        assert m, svg
        x0, x1, by, ex, ey = (float(v) for v in m.groups())
        assert (x1 - x0) * s == 40, "a wide turn: the return leg a full 40 units from the stem"
        assert abs(abs(ex - x1) - (ey - by)) < 0.01 and (ex - x1) * s > 0 and ey > by, "the exit leaves at 45 degrees, outwards and down"
        assert all(4 <= v <= 96 for v in (x0, x1, by, ex, ey)), "inside the tulip's box with the stroke"
        head = [float(v) for v in re.findall(r"[\d.]+", re.findall(r'<path d="([^"]+)"', svg)[1])]
        assert head[2:4] == [ex, ey], "the arrowhead on the return leg's end"
    assert 'stroke-width="9"' in out["follow"] and "<circle" not in out["follow"], "follow the road: a straight line, no junction dot"


def test_places(out):
    assert out["places"] == {"kind": "places", "list": [{"name": "Home", "at": [35.1, -83.2]}]}


def test_only_road_hazards_alert_the_car():
    html = cockpit_source()
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
  bare: C.routeMessage({ lat: [35, 35.01], lon: [-84, -84], dist: [0, 1100] }, null, 0, (m) => `${m} m`).options[0],
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
    # a theme without its map palettes (here a bare one) sends none: the native car map keeps what it has (F-07)
    assert maps["look"] == {"kind": "look", "theme": "tapedeck", "card": "#0A0C0B", "cardInk": "#7DF5DE", "accent": "#FFB347", "voice": False,
                            "units": "imperial", "palette": None}


def test_turn_symbols_are_tulips_in_the_cards_ink_and_never_take_markup(maps):
    assert all(s.startswith("<svg") and 'stroke="#7DF5DE"' in s for s in maps["tulips"])
    assert len(set(maps["tulips"])) == len(maps["tulips"])          # each turn draws differently
    assert "red;x" not in maps["bad"] and 'stroke="#EDE4D3"' in maps["bad"]


def test_a_route_choice_says_its_distance_and_corners(maps):
    # no Fun score: the corners are the summary (every corner counts, placeable on the map or not). One route's card shows
    # the detail and its estimates line the length, so the detail is the corners too (U-89); the length only when nothing else is known
    assert maps["withCorners"]["summary"] == "4 corners" and maps["withCorners"]["detail"] == "4 corners"
    assert maps["bare"]["detail"] == "1100 m" and maps["bare"]["summary"] == "Route"
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


def test_car_map_is_fed_for_a_smooth_glide():
    """The owner's first CarPlay drive (2026-10-30, "incredibly stuttery"): the shell sent every fix three times and the mode
    on every layout pass, and WebKit may slow a backgrounded app's web view. The page's side is checked in e2e/smoke.js."""
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert "if let p = position, p.lat == lat, p.lon == lon, p.course == course { return }" in swift, "each fix once"
    assert "guard loaded, code != sentMode else { return }" in swift, "only a changed mode"
    assert "config.preferences.inactiveSchedulingPolicy = .none" in swift, "full rate with the phone locked"
    js = open(os.path.join(ROOT, "web", "carmap.js"), encoding="utf-8").read()
    assert "requestAnimationFrame(frame)" in js and "map.jumpTo(followView(p, " in js, "the camera glides every frame"
    assert "apex-contour" not in js and "maplibre-contour" not in open(os.path.join(ROOT, "web", "carmap.html"), encoding="utf-8").read()


def test_opens_with_no_route():
    """Opening the app (or the car) starts with no route: the planned route lasts the session only (2026-10-30)."""
    html = cockpit_source()
    assert "sessionStorage.setItem(PLANNED" in html and "localStorage.setItem(PLANNED" not in html
    assert "localStorage.getItem(PLANNED)" not in html
    # ... but a route being driven survives a close, and ending the drive forgets it (the owner: "active routes")
    assert "if (track && track.kind === 'route') persistActive(track);" in html
    assert "forgetActive();                                                  // the drive is over" in html
    assert "localStorage.getItem(ACTIVE)" in html and "ACTIVE_KEEP_MS" in html


def test_a_loop_without_steps_still_guides_its_corners(out):
    """A loop or GPX track has no turn-by-turn steps; its corners are still the card (the CarPlay simulator run, 2026-10-30)."""
    g = out["loopNoSteps"]
    assert g and g["corner"] == {"dir": "R", "sev": 3} and g["distM"] == 300


def test_the_car_shows_distance_left_without_a_made_up_time():
    """A route with no router time (a GPX track) still updates the trip strip's distance; its time is CarPlay's "--"."""
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert "if let t = trip, let rm = g.remainM {" in swift
    assert "timeRemaining: g.remainS ?? -1" in swift and "timeRemaining: o.timeS ?? -1" in swift


def test_a_free_drive_has_no_arrival():
    """U-95 (REVIEW4_CHECK.md): the free drive's trip strip read "7:04 arrival · 0 min · -- mi"; now both are CarPlay's "--"."""
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    changed = swift[swift.index("@MainActor func guideChanged()"):swift.index("@MainActor func driveEnded()")]
    rec = changed[changed.index("} else if let t = trip, g.recording {"):]
    assert "Measurement(value: -1, unit: unit), timeRemaining: -1), for: t)" in rec
    assert "max(0, g.timeS ?? 0)" not in rec      # the record card's own estimates stay none (distM is nil)


def test_every_drive_reaches_the_car_and_ends_idle():
    """U-59, U-79, U-62: the page tells the car a drive started, route or none; the idle car can start one; End goes idle."""
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    html = cockpit_source()
    assert "carPost({ kind: 'start', title:" in html, "enterDrive posts start"
    assert 'case "start":' in swift and "guide = Self.recordingGuide" in swift
    assert 'CPBarButton(title: "Drive") { _ in ApexCar.shared.send("start", ["free": true]) }' in swift, "the recording test taps the label Drive"
    # after End: no trip preview of the finished route; the page clears it, the shell forgets the trip
    ended = swift[swift.index("@MainActor func driveEnded()"):]
    ended = ended[:ended.index("\n    }\n")]
    assert "routeChanged()" not in ended and "trip = nil" in ended and "hideTripPreviews()" in ended
    assert "if (track && track.kind === 'route') { car.ended = track; carRoute(null); }" in html
    # a record card carries no distance to a maneuver
    assert "recording || d != nil" in swift and "g.distM.map {" in swift
