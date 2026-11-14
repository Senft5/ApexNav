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
const n = 1001, t = { id: 'route_dest', name: 'To Robbinsville', lat: [], lon: [], dist: [], timeS: 4620, fun: { fun: 99, good: 11 },
  steps: [{ m: 1200, type: 15, street: 'Deals Gap Road' }, { m: 3000, type: 8 }, { m: 4990, type: 4 }] };
for (let i = 0; i < n; i++) { t.lat.push(35.3 + i * 5 / 110540); t.lon.push(-83.8); t.dist.push(i * 5); }
const opts = [{ fun: { fun: 99, good: 11 }, timeS: 4620, distM: null }, { fun: { fun: 40, good: 1 }, timeS: 3900, distM: 70000 }];
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
  placesAll: C.placesMessage([{ label: 'Maryville', lat: 35.7, lon: -83.9 }, { label: 'home', lat: 35.3, lon: -83.3 }],
    [{ name: 'Home', label: '12 Oak St, Maryville', lat: 35.1, lon: -83.2 }, { name: 'Work', label: 'Work', lat: 35.2, lon: -83.1 }, { name: 'Bad', lat: null, lon: 1 }],
    [{ id: 'r1', name: 'Cherohala Skyway', miles: 42.3 }, { id: 'r2', name: 'Tail', miles: null }, { name: 'No id' }],
    (m) => `${Math.round(m / 1609.344)} mi`),
  placesAttack: C.placesMessage([], [{ name: 'Home', lat: 35.1, lon: -83.2 }], [{ id: 'r1', name: 'Cherohala Skyway', miles: 42.3 }], null,
    [{ id: 77, name: 'Clinch River loop', detail: 'Featured · 20 mi' }, { id: 'ta-2', name: 'Tail of the Dragon', detail: '11 mi' }]).list,
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
  // U-112: a glance's words. The review's corner: plain words, acute, long, careful; the same corner in rally words; a
  // turn onto a long road name; a short call that needs none; a hairpin in plain words with its caution
  ...(() => { const P = require(process.argv[1] + '/web/plain_notes.js');
    const ev = (o) => ({ id: 'g', dist: [0, 5000], events: [{ type: 'corner', dir: 'L', start_m: 300, dist_m: 320, ...o }] });
    const plainOpts = { call: (e) => P.plainCall(e), plain: true };
    return {
      glancePlain: C.guideMessage(ev({ severity: 1, shape: 'acute', mods: ['long'], caution: 1, call: 'Left 1 acute long, care' }), 0, null, D.phrase, plainOpts),
      glanceRally: C.guideMessage(ev({ severity: 2, mods: ['long', 'tightens'], caution: 2, call: 'Left 2 long tightens into right 4, caution' }), 0, null, D.phrase),
      glanceHP: C.guideMessage(ev({ severity: 'HP', mods: ['long', 'over crest'], caution: 1, call: 'Left hairpin long over crest, care' }), 0, null, D.phrase, plainOpts),
      glanceRecce: C.guideMessage(ev({ severity: 1, shape: 'acute', mods: ['long'], caution: 1, recce: true, call: 'Left 1 acute long over crest, care' }), 0, null, D.phrase, plainOpts),
      glanceFits: C.guideMessage(ev({ severity: 3, call: 'Left 3' }), 0, null, D.phrase, plainOpts),
      glanceTurn: C.guideMessage({ id: 'tt', dist: [0, 5000], steps: [{ m: 900, type: 10, street: 'Ronald Reagan Cross County Highway' }] }, 0, null, D.phrase),
      glanceMax: C.GLANCE_MAX,
      // T-1: a caution whose glance is still too long, a follow step on a long road, a turn whose short form is still long
      glanceSlow: C.guideMessage(ev({ severity: 1, shape: 'acute', mods: ['long'], caution: 3, call: 'Left 1 acute long, double caution' }), 0, null, D.phrase, plainOpts),
      glanceFollow: C.guideMessage({ id: 'gf', dist: [0, 9000], steps: [{ m: 50, type: 8, street: 'Ronald Reagan Cross County Highway' }, { m: 8000, type: 10, street: 'Elm St' }] }, 100, null, D.phrase),
      glanceCall: C.guideMessage(ev({ severity: 3, call: 'Left 3 into right 4 over crest don\'t cut' }), 0, null, D.phrase),
      clips: ['Very sharp left, almost back on itself, long, careful', 'Recording · the road ahead', 'Left 3', 'Supercalifragilisticexpialidociously'].map(C.glanceClip),
    }; })(),
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
    # one route: the card's title is its name and the car prints time and length, so the summary is its good corners (SO-1:
    # never a "Fun 99" score); the card shows only the detail above its estimates, so that says what the route is too
    # (U-89: "35.4 mi" twice, a blank middle)
    assert one["options"][0]["summary"] == "11 good corners" and one["options"][0]["detail"].startswith("11 good corners")
    assert one["options"][0]["timeS"] == 4620 and one["options"][0]["distM"] == 5000
    two = out["two"]
    assert [o["summary"] for o in two["options"]] == ["11 good corners · 77 min", "1 good corner · 65 min"] and two["picked"] == 1
    assert two["options"][0]["distM"] is None, "an option not built yet has no known length"
    assert out["none"] is None


def test_next_maneuver(out):
    assert out["g0"] == {"kind": "guide", "key": "route_dest:1200", "instruction": "Turn left onto Deals Gap Road", "short": ["Turn left"], "street": "Deals Gap Road",
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
    assert out["rec0"] == {"kind": "guide", "key": "rec:", "instruction": "Recording · the road ahead", "short": ["Recording"],
                           "street": "Recording", "type": 8, "recording": True}
    assert out["rec1"]["instruction"] == "Recording · 4.2 mi driven" and out["rec1"]["key"] == "rec:4.2 mi" and out["rec1"]["street"] == "4.2 mi driven"
    assert "distM" not in out["rec1"] and "distM" not in out["rec0"]
    assert out["recNull"]["instruction"] == "Recording · the road ahead", "unknown distance: nothing said about it"
    # U-120: the distance the words say goes to the trip strip too; none before there is one
    assert out["rec1"]["drivenM"] == 6800 and "drivenM" not in out["rec0"] and "drivenM" not in out["recNull"]
    assert 'stroke="#7DF5DE"' in out["recordSvg"] and 'fill="#FFB347"' in out["recordSvg"]
    assert "red;x" not in out["recordBad"] and "url(" not in out["recordBad"]


def test_the_card_reads_at_a_glance(out):
    """U-112 (REVIEW5 guided-drive car/035): "Very sharp left, almost back on itself, long, careful" on four lines at card
    size for half a mile. A long instruction carries `short`, the same instruction in fewer words, longest first."""
    g = out["glancePlain"]
    # M-1 (panel round 1): the call's grammar, the warning first and an acute corner a hairpin
    assert g["instruction"] == "Careful, hairpin left, long"
    assert g["short"] == ["Careful, hairpin left", "Hairpin left"], "its kind and its caution, the modifiers dropped"
    assert out["glanceHP"]["short"] == ["Careful, hairpin left", "Hairpin left"]
    assert out["glanceRally"]["short"] == ["Left 2, caution", "Left 2"], "rally words stay rally words"
    assert out["glanceRecce"]["short"] == ["Left 1, care", "Left 1"], "a recce's own notes are not the plain words"
    assert "short" not in out["glanceFits"], "a call that already fits a glance needs no other"
    assert out["glanceTurn"]["instruction"] == "Turn right onto Ronald Reagan Cross County Highway"
    assert out["glanceTurn"]["short"] == ["Turn right"] and out["glanceTurn"]["street"] == "Ronald Reagan Cross County Highway"
    for key in ("glancePlain", "glanceRally", "glanceHP", "glanceRecce", "glanceTurn"):
        sh = out[key]["short"]
        assert sh[0] and all(len(v) <= out["glanceMax"] for v in sh), (key, sh)
        assert all(len(a) > len(b) for a, b in zip([out[key]["instruction"]] + sh, sh)), "each shorter than the one before"
    assert out["glanceMax"] == 24


def test_every_long_call_has_a_glance_that_fits(out):
    """T-1/I-4 (panel round 1, guided-drive car/005-011): CarPlay shows the longest variant that fits, so every form the
    card is sent must fit a glance, and a call too long for one always gets at least one form."""
    m = out["glanceMax"]
    for key in ("glancePlain", "glanceRally", "glanceHP", "glanceRecce", "glanceTurn", "glanceSlow", "glanceFollow", "glanceCall", "rec0", "rec1"):
        g = out[key]
        assert len(g["instruction"]) > m, (key, "the case should need a glance")
        assert g.get("short"), (key, g)
        assert all(0 < len(v) <= m for v in g["short"]), (key, g["short"])
    # the caution's words don't fit with the kind (the slow-down warning with the kind), so the kind alone, never mid-word
    assert out["glanceSlow"]["short"] == ["Hairpin left"]   # panel M-1: the call grammar names it a hairpin
    # a follow step on a long road: the call's own words, cut at a word
    assert out["glanceFollow"]["instruction"] == "Follow Ronald Reagan Cross County Highway"
    assert out["glanceFollow"]["short"] == ["Follow Ronald Reagan"]
    # a corner whose own call is long (rally words, no plain form) keeps its kind and side
    assert out["glanceCall"]["short"][0].startswith("Left 3")
    assert out["rec0"]["short"] == ["Recording"] and out["rec1"]["short"] == ["Rec · 4.2 mi driven", "Recording"]
    assert out["clips"] == ["Very sharp left", "Recording · the road", "Left 3", "Supercalifragilisticexpi"]


def _guide_changed():
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    return swift, swift[swift.index("@MainActor func guideChanged()"):swift.index("@MainActor func driveEnded()")]


def test_the_card_is_sent_only_glance_forms():
    """T-1/I-4: the shell sends the card the short forms (else the call cut to a glance) and the street when it fits;
    never the whole call. U-112's short-first ordering did nothing because CarPlay picks the longest that fits."""
    swift, changed = _guide_changed()
    assert 'short: ((dict["short"] as? [Any]) ?? []).prefix(3).compactMap { $0 as? String }' in swift
    assert "var short: [String] = []" in swift
    assert "static let glanceMax = 24" in swift
    assert "for v in (g.short.isEmpty ? [g.instruction] : g.short).map(ApexCar.glance) + [g.street]" in changed
    assert "where !v.isEmpty && v.count <= ApexCar.glanceMax && !variants.contains(v)" in changed
    assert "m.instructionVariants = variants" in changed
    # the whole call is never a variant on its own
    assert "[g.instruction] + " not in changed and "[g.instruction, g.street]" not in changed
    # the free drive's first card, before the page says anything, has its glance too
    assert 'recording: true, short: ["Recording"])' in swift
    # the shell's clip is web/carplay.js's: last clause that fits, else last word, trimmed
    glance = swift[swift.index("static func glance(_ text: String) -> String {"):]
    glance = glance[:glance.index("\n    }\n")]
    for part in ("guard s.count > glanceMax else { return s }", "String(s.prefix(glanceMax + 1))", 'cut.lastIndex(of: ",")',
                 "< 6 { end = nil }", 'cut.lastIndex(of: " ")', 'CharacterSet(charactersIn: " ,·.-")'):
        assert part in glance, part
    html = cockpit_source()
    assert "plain: state.noteWords === 'plain' && !!window.ApexPlainNotes" in html, "the page says which words the call is in"


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
    # as Where to? lists them: pinned first (the address it was pinned from under it), saved routes, then recents; a
    # recent with a pinned place's name is the pinned one
    assert out["placesAll"]["list"] == [
        {"name": "Home", "at": [35.1, -83.2], "detail": "12 Oak St, Maryville"}, {"name": "Work", "at": [35.2, -83.1]},
        {"name": "Cherohala Skyway", "saved": "r1", "detail": "Saved · 42 mi"}, {"name": "Tail", "saved": "r2", "detail": "Saved"},
        {"name": "Maryville", "at": [35.7, -83.9]}]
    js = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "ApexCarPlay.placesMessage(recentPlaces())" not in js and js.count("carPost(carPlaces())") >= 7, "pin, unpin, save and remove re-send the car's Places"
    assert "m.action === 'saved' && typeof m.id === 'string' && !driveActive" in js
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert 'ApexCar.shared.send("saved", ["id": id])' in swift
    # this week's time attack loop, once entered, after the pinned places: the phone drives the loop itself
    assert out["placesAttack"][1] == {"name": "Clinch River loop", "attack": "77", "detail": "Time attack · Featured · 20 mi"}
    assert "summaryLine(w" not in js, "the board and your place on it stay on the phone: no scores in the car"
    assert [r["name"] for r in out["placesAttack"]] == ["Home", "Clinch River loop", "Tail of the Dragon", "Cherohala Skyway"]
    assert "const c = car.attacks.find((x) => String(x.segment_id) === String(m.id));" in js
    assert 'ApexCar.shared.send("attack", ["id": id])' in swift
    ta = open(os.path.join(ROOT, "web", "time_attack.js"), encoding="utf-8").read()
    assert "if (page.entered) page.entered(enteredLoops(r.j), week);" in ta


def test_only_road_hazards_alert_the_car():
    html = cockpit_source()
    assert "if (text && opts.alert && driveActive) carPost({ kind: 'hazard'" in html
    # the urgent speech lane also carries turn-now directions and crests: only member, reported and convoy hazards set alert,
    # and the DOTs' slow traffic on the route ahead (road_events.js, dotAheadTick)
    assert html.count("alert: true") == 4


MAPRUN = r"""
const C = require(process.argv[1] + '/web/carplay.js');
const t = { events: [{ type: 'corner', dir: 'L', severity: 4, lat: 35.1, lon: -83.9 }, { type: 'corner', dir: 'R', severity: 'HP', dist_m: 500 },
  { type: 'corner', dir: 'R', severity: 2, dist_m: 900 }, { type: 'bump', dist_m: 100 }, { type: 'corner', dir: 'R', severity: 3 }] };
const at = (m) => ({ lat: 35 + m / 1e5, lon: -84 });
console.log(JSON.stringify({
  corners: C.cornersMessage(t, at), none: C.cornersMessage(null, at),
  // M-3 (panel round 1): the plates in the driver's notation, as the strip's next cells print it
  plainPlates: C.cornersMessage({ events: [...t.events, { type: 'corner', dir: 'L', severity: 2, shape: 'square', dist_m: 1000 }, { type: 'corner', dir: 'R', severity: 1, shape: 'acute', dist_m: 1100 }] }, at, 'plain').list.map((c) => c.text),
  rallyPlates: C.cornersMessage({ events: [{ type: 'corner', dir: 'L', severity: 4, grade: '-', dist_m: 10 }, { type: 'corner', dir: 'L', severity: 2, shape: 'square', dist_m: 1000 }, { type: 'corner', dir: 'R', severity: 1, shape: 'acute', dist_m: 1100 }] }, at, 'rally').list.map((c) => c.text),
  cams: C.hazardsMessage([{ id: 7, kind: 'gravel', lat: 35.2, lon: -83.5 }], { gravel: 'Gravel' },
    [{ kind: 'alpr', lat: 35.31, lon: -83.41 }, { kind: 'speed', lat: 35.3, lon: -83.4 }, { kind: 'speed', lat: null, lon: 1 }]).list,
  camsFull: C.hazardsMessage(Array.from({ length: 40 }, (_, i) => ({ id: i, kind: 'gravel', lat: 35, lon: -83 })), {}, [{ kind: 'speed', lat: 35.3, lon: -83.4 }]).list.length,
  hazards: C.hazardsMessage([{ id: 7, kind: 'gravel', lat: 35.2, lon: -83.5 }, { id: 8, label: 'Cattle grid', lat: 35, lon: -83 }, { id: 9, kind: 'x' }], { gravel: 'Gravel' }),
  along: C.alongMessage([{ kind: 'cafe', name: 'Bean There Coffee' }, { kind: 'view', name: 'Overlook' }, { kind: 'fuel', name: 'Shell' }, { kind: 'fuel', name: 'Speedway' },
    { kind: 'fuel', name: 'Marathon' }, { kind: 'fuel', name: null }]),
  alongUnnamed: C.alongMessage([{ kind: 'fuel', name: null }, { kind: 'cafe', name: '' }, { kind: 'cafe' }]),
  alongLong: C.alongMessage([{ kind: 'cafe', name: 'The Extremely Long Named Mountain Coffee Roasters' }]),
  alongPlates: C.alongMessage([{ kind: 'cafe', name: 'The Extremely Long Named Mountain Coffee Roasters', lat: 35.1234567, lon: -83.9 }, { kind: 'view', name: 'Overlook', lat: 35, lon: -84 },
    { kind: 'fuel', name: null, lat: 35.2, lon: -83.8 }, { kind: 'fuel', name: 'Shell' }]).places,
  alongMany: C.alongMessage(Array.from({ length: 50 }, (_, i) => ({ kind: 'fuel', name: 'S' + i, lat: 35 + i / 100, lon: -84 }))).places.length,
  offer: C.offerMessage('o3', 'Police reported on your route in 1.2 mi.', 'Police in 1.2 mi', 'Go round', 15000),
  offerSame: C.offerMessage('o4', 'Running 12 min late for home.', 'Running 12 min late for home.', 'Skip Cherohala Skyway', 60000),
  notice: [C.noticeMessage("Couldn't get your location. Type a start or tap the map."), C.noticeMessage('  '),
    C.noticeMessage("Loops use Vetta's own road map, which covers Ohio, Kentucky and Indiana so far.")],
  laneGuide: C.guideMessage({ id: 'r', dist: [0, 5000], steps: [{ m: 1200, type: 15, street: 'Deals Gap Road', lanes: [[2, 0, 0], [2, 0, 0], [64, 64, 0]] }] }, 100, 3600, require(process.argv[1] + '/web/directions.js').phrase),
  noLanes: C.guideMessage({ id: 'r', dist: [0, 5000], steps: [{ m: 1200, type: 15, street: 'Deals Gap Road' }] }, 100, 3600, require(process.argv[1] + '/web/directions.js').phrase),
  laneGlyphs: [C.laneGlyphs(require(process.argv[1] + '/web/lanes.js').lanes([[2, 0, 0], [10, 8, 2], [256, 0, 0]])), C.laneGlyphs([{ angle: 0, use: false, ok: false }, { angle: 0 }]),
    C.laneGlyphs(Array.from({ length: 9 }, () => ({ angle: 0, use: true })))],
  stops: C.stopsMessage([{ kind: 'fuel', name: ' Shell ', lat: 35.1, lon: -84, m: 5000 }, { kind: 'cafe', name: '', lat: 35.2, lon: -84, m: 2000 },
    { kind: 'view', name: 'Overlook', lat: 35.3, lon: -84, m: 3000 }, { kind: 'charge', name: 'EVgo', lat: 35.4, lon: -84, m: 1100 }, { kind: 'fuel', name: 'Behind', lat: 35, lon: -84, m: 900 }], 1000,
    (m) => `${(m / 1609.344).toFixed(1)} mi`),
  stopsNone: C.stopsMessage(null, 0),
  nearby: C.nearbyMessage('gas', 'Gas', [{ label: 'Pilot', lat: 35.601, lon: -84.1, m: 111 }, { label: '', lat: 1, lon: 1, m: 5 }, { label: 'Shell', lat: 35.6, lon: -84.09, m: 905 }],
    (m) => `${m} m`, 'No gas on the map within 5 mi.'),
  nearbyNone: C.nearbyMessage('coffee', 'Coffee', [], null, 'No coffee on the map within 5 mi.'),
  nearbyKeys: C.nearbyKeys(['charge', 'coffee', 'nope'], { charge: { label: 'Chargers' }, coffee: { label: 'Coffee' } }),
  arrived: [C.arrivedMessage('Maryville'), C.arrivedMessage('Cherohala Skyway Visitor Center'), C.arrivedMessage('')],
  paused: ['Rerouting…', 'Wrong way · no signal to reroute', 'Off route', null, ''].map((w) => C.pausedMessage(w)),
  limits: [C.limitMessage(54.7, 'mph'), C.limitMessage(80, 'km/h'), C.limitMessage(null, 'mph'), C.limitMessage(0, 'mph'), C.limitMessage(500, 'mph')],
  loops: [C.loopsMessage('time', false), C.loopsMessage('distance', false), C.loopsMessage('distance', true)],
  offerUndo: C.offerMessage('o8', 'Pothole reported', '', 'Undo', 5000, 'OK'),
  offerNone: [C.offerMessage('', 'x', '', 'k'), C.offerMessage('o5', '', '', 'k'), C.offerMessage('o6', 'x', '', ''), C.offerMessage('o7', 'x', '', 'k', 1000).seconds],
  alongDescent: C.alongMessage([], 'Long descent: 3.7 mi at 8% +1'),
  alongCharge: C.alongMessage([{ kind: 'charge', name: 'Tesla Supercharger', lat: 35.5, lon: -83.5 }, { kind: 'charge', name: null, lat: 35.6, lon: -83.6 }]),
  alongNone: [C.alongMessage([]), C.alongMessage(null), C.alongMessage([{ kind: 'view', name: 'Overlook' }])],
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


def test_the_cars_plates_say_what_the_head_says(maps):
    """Panel round 1 M-3: "R4" on the car's map under a card that said "Open left". Plain words on: plain plates."""
    assert maps["plainPlates"] == ["OPEN L", "HAIRPIN R", "TIGHT R", "SQUARE L", "HAIRPIN R"]
    assert maps["rallyPlates"] == ["L4-", "SQ L", "RHP"], "real rally notation, never LSQ or RAC"
    html = cockpit_source()
    assert "ApexCarPlay.cornersMessage(t, (m) => sample(t, m), state.noteWords)" in html
    assert "|${state.noteWords}` : '';" in html, "a change of words sends the plates again"


def test_hazards_are_named_and_unplaceable_ones_dropped(maps):
    assert maps["hazards"]["list"] == [{"id": "7", "at": [35.2, -83.5], "title": "Gravel"}, {"id": "8", "at": [35, -83], "title": "Cattle grid"}]


def test_the_cafes_and_fuel_along_go_to_the_car_by_name(maps):
    """The owner, 2026-11-11: show the café's or the station's name. The car's route preview names them, in route order."""
    assert maps["along"] == {"kind": "along", "full": "Café: Bean There Coffee · Fuel: Shell, Speedway +2", "short": "Bean There Coffee · Shell +3", "places": [], "descent": ""}
    assert maps["alongUnnamed"] == {"kind": "along", "full": "Café: 2 cafés · Fuel: 1 stop", "short": "2 cafés · 1 fuel stop", "places": [], "descent": ""}, "no name: counted, never invented"
    assert maps["alongLong"]["full"] == "Café: The Extremely Long Named Mo…"
    assert all(m == {"kind": "along", "full": "", "short": "", "places": [], "descent": ""} for m in maps["alongNone"]), "nothing along clears the car's line; viewpoints stay on the phone"
    # and on the car's map, a plate at each one: its name, or what it is when the map has none; never a viewpoint
    assert maps["alongPlates"] == [{"at": [35.123457, -83.9], "kind": "cafe", "text": "The Extremely Lon…"}, {"at": [35.2, -83.8], "kind": "fuel", "text": "Fuel"}]
    assert maps["alongMany"] == 30
    # an electric car's chargers (scenic.js forCar keeps them instead of the pumps): named on the car and on its map
    assert maps["alongCharge"]["full"] == "Charge: Tesla Supercharger +1" and maps["alongCharge"]["short"] == "Tesla Supercharger +1"
    assert [p["kind"] for p in maps["alongCharge"]["places"]] == ["charge", "charge"] and maps["alongCharge"]["places"][1]["text"] == "Charger"
    for f in ("CarPlay/ApexCarPlay.swift", "CarPlay/ApexCarMap.swift", "web/carmap.js", "web/carmap.html"):
        assert "charge" in open(os.path.join(ROOT, *f.split("/")), encoding="utf-8").read(), f + " takes the chargers too"
    # a long descent rides on the same line, alone when nothing is along (brake_heat.js descentShort)
    assert maps["alongDescent"] == {"kind": "along", "full": "", "short": "", "places": [], "descent": "Long descent: 3.7 mi at 8% +1"}
    assert "if (car.route && track === t) carAlong(t);                      // and on the car's route preview" in cockpit_source()
    js = cockpit_source()
    assert "car.along = ''; carAlong(t);" in js, "every route sent to the car is followed by its places"
    assert "if (car.route && track === t) carAlong(t);" in js, "and the places are sent when they come in"
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert 'case "along":' in swift and "line([o.detail, along.short, along.descent])" in swift
    assert "line([o.detail, along.full" not in swift, "the car preview names one place per kind, never the two-name line"
    assert 'detailText: "A twisty loop' not in swift and 'header: "Twisty loops, back where you started"' in swift
    # the car's map, native and its web fallback: the places after the hazards and corners, so a name never hides a corner
    native = open(os.path.join(ROOT, "CarPlay", "ApexCarMap.swift"), encoding="utf-8").read()
    carmap = open(os.path.join(ROOT, "web", "carmap.js"), encoding="utf-8").read()
    assert "hazards.filter(near) + cs.prefix(all ? 160 : 40) + places.filter(near)" in native
    assert ".concat(state.places.filter(near)" in carmap and "places(list) {" in carmap
    assert swift.count("showPlaces(); setMode()") == 2, "a car map that connects later is given the places too"


def test_the_phones_one_key_offers_reach_the_car(maps):
    """Go round, Skip and Head home were phone-only toasts in a drive; the car shows them as a navigation alert."""
    assert maps["offer"] == {"kind": "offer", "id": "o3", "title": "Police reported on your route in 1.2 mi.", "short": "Police in 1.2 mi",
                             "key": "Go round", "seconds": 15}
    assert maps["offerSame"]["short"] == "" and maps["offerSame"]["key"] == "Skip Cherohala…" and maps["offerSame"]["seconds"] == 20
    assert maps["offerNone"] == [None, None, None, 5]
    js = cockpit_source()
    assert js.count("offerKey(`") == 4, "the police report ahead, the road closure ahead, a DOT crash or closure ahead and the late-for-home offers"
    assert "m.action === 'offer' && car.offer && m.id === car.offer.id && performance.now() < car.offer.until" in js
    assert "carPost({ kind: 'offerDone', id })" in js
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert 'case "offer":' in swift and 'case "offerDone":' in swift and 'ApexCar.shared.send("offer", ["id": id])' in swift
    assert "cancel" not in maps["offer"], "without a cancel the car says Not now"
    assert 'cancel.isEmpty ? "Not now" : cancel' in swift


def test_a_report_from_the_car_has_its_undo_on_the_car(maps):
    """The phone's Report key turns into Undo for a moment; a report from the car's grid gets the car's own Undo."""
    assert maps["offerUndo"] == {"kind": "offer", "id": "o8", "title": "Pothole reported", "short": "", "key": "Undo", "seconds": 5, "cancel": "OK"}
    js = cockpit_source()
    assert "reportHazard(m.kind, null, true)" in js
    assert "carPost(ApexCarPlay.offerMessage(id, `${word} reported`, '', 'Undo', ms, 'OK'))" in js
    assert "if (pendingHz.carOffer) carPost({ kind: 'offerDone', id: pendingHz.carOffer });" in js, "an Undo on the phone takes the car's away"


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
    """U-95 (REVIEW4_CHECK.md): the free drive's trip strip read "7:04 arrival · 0 min · -- mi"; its time is CarPlay's "--".
    U-120 (REVIEW5 free-drive car/002 to 019): "-- arrival · -- min · -- mi" for five minutes; the strip carries the distance
    driven once there is one, and never a time."""
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    changed = swift[swift.index("@MainActor func guideChanged()"):swift.index("@MainActor func driveEnded()")]
    rec = changed[changed.index("} else if let t = trip, g.recording {"):]
    assert "let driven = g.drivenM.map { ApexCar.shared.distance($0) } ?? Measurement(value: -1, unit: unit)" in rec
    assert "CPTravelEstimates(distanceRemaining: driven, timeRemaining: -1), for: t)" in rec
    assert "max(0, g.timeS ?? 0)" not in rec      # the record card's own estimates stay none (distM is nil)
    assert 'drivenM: Self.num(dict["drivenM"]).map { max(0, $0) }' in swift


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


def test_the_car_offers_the_same_loop_times_as_the_phones_dial():
    """The phone's loop dial has five times; the car's Loops list had three of its own (30 minutes, 1 hour, 2 hours)."""
    import re
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    row = re.search(r"let times: \[\(name: String, minutes: Int\?, miles: Double\?\)\] = \[(.*?)\]\n", swift, re.S).group(1)
    car = [int(m) for m in re.findall(r'\("[^"]+", (\d+), nil\)', row)]
    dial = json.loads(re.search(r"LOOP_MINUTES = (\[[\d, ]+\])", cockpit_source()).group(1))
    assert car == dial == [30, 60, 90, 120, 180]
    assert '("1½ hours", 90, nil)' in row and '("3 hours", 180, nil)' in row
    # and the page takes every one of them: it used to accept only 30, 60 and 120, so the car's 1½ and 3 hours did nothing
    assert "m.action === 'loop' && LOOP_MINUTES.includes(m.minutes)" in cockpit_source()


def test_the_cars_map_shows_the_routes_speed_cameras(maps):
    """Waze shows speed cameras on the car; Vetta knew the route's cameras (the phone's notes) and the car didn't."""
    gravel, speed, lpr = maps["cams"]
    assert gravel["title"] == "Gravel", "reports first"
    assert speed == {"id": "cam:35.3,-83.4", "at": [35.3, -83.4], "title": "Speed camera"}, "speed cameras before plate readers"
    assert lpr["title"] == "Camera" and len(maps["cams"]) == 3, "a camera with no place is dropped"
    assert maps["camsFull"] == 40
    js = cockpit_source()
    assert "Array.isArray(plannedRoute.alpr) && state.toggles.lpr ? plannedRoute : null;" in js, "the phone's camera switch"
    assert "carHazards();                                                      // and its cameras" in js


def test_overview_shows_the_whole_route_while_guiding():
    """Apple Maps and Waze have Overview while guiding; the car could only follow the arrow or be panned."""
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert '[CPBarButton(title: "Stops") { _ in ApexCar.shared.send("stops") }, overview]' in swift, "a route only, beside Stops"
    assert 'if b.title == "Overview" { mapController?.overview(); b.title = "Recentre" } else { mapController?.recentre(); b.title = "Overview" }' in swift
    assert 'mapController?.recentre(); overviewButton?.title = "Overview"' in swift, "a pan ends it"
    assert '@MainActor func overview() { if let native { native.overview() } else { js("car.overview()") } }' in swift
    native = open(os.path.join(ROOT, "CarPlay", "ApexCarMap.swift"), encoding="utf-8").read()
    assert "func overview() {" in native and "follow = false; overviewing = true\n        fitRoute(animated: true)" in native and "|| overviewing { fitRoute(animated: true) }" in native
    web = open(os.path.join(ROOT, "web", "carmap.js"), encoding="utf-8").read()
    assert "overview() {" in web and "state.follow = false; state.overview = true; fitRoute(" in web


def test_nearby_on_the_cars_places(maps):
    """Apple Maps on CarPlay has Gas, Coffee and Food; the phone had Find nearby and the car didn't."""
    n = maps["nearby"]
    assert n["kind"] == "nearby" and n["cat"] == "gas" and n["title"] == "Gas" and n["empty"] == ""
    assert [r["name"] for r in n["list"]] == ["Pilot", "Shell"] and n["list"][0] == {"name": "Pilot", "detail": "111 m", "at": [35.601, -84.1]}
    assert maps["nearbyNone"]["list"] == [] and maps["nearbyNone"]["empty"] == "No coffee on the map within 5 mi."
    assert maps["nearbyKeys"] == [{"cat": "charge", "name": "Chargers"}, {"cat": "coffee", "name": "Coffee"}]
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert 'case "nearby":' in swift and 'ApexCar.shared.send("nearby", ["cat": cat])' in swift
    assert 'CPListSection(items: kinds, header: "Nearby", sectionIndexTitle: nil)' in swift
    assert "self?.go(to: p.coord, name: p.name)" in swift, "a tap plans the way there, as Where to? does"
    js = cockpit_source()
    assert "nearbyFor(cat).then(({ rows, failed }) => carPost(ApexCarPlay.nearbyMessage(" in js


def test_the_car_says_arrived_at_the_end(maps):
    """Apple Maps ends a trip with "Arrived"; the car's card sat on "Arriving" at 0 ft for the rest of the drive."""
    short, long, none = maps["arrived"]
    assert short == {"kind": "paused", "key": "arrived", "reason": "arrived", "text": "Arrived · Maryville"}
    assert long["text"] == "Arrived" and none["text"] == "Arrived", "a name too long for a glance is left off"
    js = cockpit_source()
    assert "if (end > 500 && Math.max(state.cursorM, routeWatch.bestM) > end - 40 && !String(track.id || '').startsWith('loop_')) {" in js, "a loop says nothing at its start"


def test_off_route_the_car_says_rerouting(maps):
    """Apple Maps and Waze say "Rerouting" on the car; Vetta's card kept the last turn, its distance frozen, while off route."""
    rr, wrong, off, none, empty = maps["paused"]
    assert rr == {"kind": "paused", "key": "off:Rerouting…", "reason": "rerouting", "text": "Rerouting…"}
    assert wrong["reason"] == "proceed" and len(wrong["text"]) <= 24 and wrong["text"].startswith("Wrong way")
    assert off["reason"] == "proceed" and off["text"] == "Off route"
    assert none is None and empty is None, "on the route: the maneuver, never a pause"
    js = cockpit_source()
    assert "state.cursorIdx < 0 ? ApexCarPlay.pausedMessage(offRouteText()) : null;" in js, "the status line's own words"
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert 'case "paused":' in swift and "session.pauseTrip(for: reason, description: text)" in swift and 'why == "rerouting" ? .rerouting : why == "arrived" ? .arrived : .proceedToRoute' in swift
    assert "maneuver = nil; maneuverKey = \"\"" in swift, "the next guide resumes the trip"


def test_add_a_stop_from_the_car(maps):
    """Apple Maps and Waze add a stop while guiding; the phone could ("Add as a stop") and the car couldn't."""
    rows = maps["stops"]["list"]
    assert [r["name"] for r in rows] == ["Café", "Shell"], "ahead only, 150 m on at least, fuel and cafés by name, no viewpoints"
    assert rows[0]["detail"] == "0.6 mi ahead" and rows[1]["detail"] == "Fuel · 2.5 mi ahead" and rows[1]["at"] == [35.1, -84]
    assert maps["stopsNone"] == {"kind": "stops", "list": []}
    js = cockpit_source()
    assert "else if (m.action === 'stops') carPost(ApexCarPlay.stopsMessage(" in js
    assert "if (p) carAsked(() => addViaAt({ lat: p.lat, lon: p.lon," in js, "only a place on the route's own list, and a failure says why on the car"
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert '[CPBarButton(title: "Stops") { _ in ApexCar.shared.send("stops") }, overview]' in swift and 'case "stops":' in swift
    assert 'ApexCar.shared.send("stop", ["lat": s.lat, "lon": s.lon, "name": s.name])' in swift


def test_the_cars_map_shows_the_posted_speed_limit(maps):
    """Apple Maps and Waze show the posted limit on the car; Vetta knew it (OSM, the binnacle's LIMIT) and the car didn't."""
    mph, kmh, none, zero, silly = maps["limits"]
    assert mph == {"kind": "limit", "value": 55, "unit": "MPH", "round": False}
    assert kmh == {"kind": "limit", "value": 80, "unit": "KM/H", "round": True}
    assert none["value"] is None and zero["value"] is None and silly["value"] is None, "unknown stays unknown: no sign"
    js = cockpit_source()
    assert "carLimit(live ? si.limit : null, si.unit);" in js and "carLimit(null); return; }" in js, "only while the drive is live"
    assert "car.limitKey = '';" in js, "a car that connects later gets it again"
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert 'case "limit":' in swift and "let l = role == .cluster ? nil : ApexCar.shared.limit" in swift, "never in the cluster"
    native = open(os.path.join(ROOT, "CarPlay", "ApexCarMap.swift"), encoding="utf-8").read()
    assert "final class ApexCarLimitView" in native and "if limit != nil { shownBoxes.append(limitSign.frame" in native, "plates keep clear of it"
    web = open(os.path.join(ROOT, "web", "carmap.js"), encoding="utf-8").read()
    assert "limit(l) {" in web and "if (g.limit) out.push(g.limit);" in web


def test_the_cars_guidance_card_shows_the_junctions_lanes(maps):
    """Apple Maps and Waze show which lanes to be in on the car's card; the phone's road book drew them and the car didn't."""
    g = maps["laneGuide"]
    assert g["lanes"] == [[2, 0, 0], [2, 0, 0], [64, 64, 0]] and g["type"] == 15, "the step's lanes ride with its card"
    assert "lanes" not in maps["noLanes"] and maps["noLanes"]["type"] == 15, "a step with no lane data sends none: unknown stays unknown"
    lit, none, wide = maps["laneGlyphs"]
    assert [x["alpha"] for x in lit] == [0.22, 1, 0.22] and lit[1]["rotate"] == -90, "the lane to use at full ink, its own arrow"
    assert lit[2]["rotate"] == 0 and lit[2]["d"].startswith("M4 10"), "a U-turn lane is drawn as one, unrotated"
    assert none == [] and wide == [], "nothing to use, or too many lanes to read: no image"
    js = cockpit_source()
    assert "{ lanes, ...msg } = g, ln = lanes ? carLanes(lanes) : null" in js, "the packed lanes never go to the car, only the picture"
    assert "ApexCarPlay.laneGlyphs(ApexLanes.lanes(packed))" in js
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert 'lanes: (dict["lanes"] as? String).flatMap { Data(base64Encoded: $0) }' in swift
    assert "m.junctionImage = lanes.withRenderingMode(.alwaysOriginal)" in swift


def test_the_cars_loops_list_is_the_phones_dial_by_time_or_distance(maps):
    """The car offered only times while the phone's dial is set to distance by default: the car now gets the dial itself."""
    time, mi, km = maps["loops"]
    assert [r["name"] for r in time["list"]] == ["30 minutes", "1 hour", "1½ hours", "2 hours", "3 hours"]
    assert [r["minutes"] for r in time["list"]] == [30, 60, 90, 120, 180]
    assert [r["name"] for r in mi["list"]] == ["15 mi", "30 mi", "45 mi", "60 mi", "90 mi"] and mi["list"][0]["miles"] == 15
    assert [r["name"] for r in km["list"]] == ["25 km", "50 km", "75 km", "100 km", "150 km"]
    assert abs(km["list"][0]["miles"] - 25 / 1.609344) < 1e-9 and all("minutes" not in r for r in km["list"])
    js = cockpit_source()
    assert "const km = ApexCarPlay.LOOP_KM[i], mi = ApexCarPlay.LOOP_MI[i];" in js, "the dial and the car share one set"
    assert js.count("carPost(ApexCarPlay.loopsMessage(loopBy, ApexUnits.metric()))") == 2, "on hello and whenever the dial changes"
    assert "carAsked(() => loop(m.miles))" in js and "Math.abs(x - m.miles) < 0.01" in js, "only a distance the dial has"
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert 'case "loops":' in swift and 'ApexCar.shared.send("loop", ["miles": mi])' in swift
    assert "let loops = ApexCar.shared.loops.isEmpty ? times : ApexCar.shared.loops" in swift


def test_a_close_convoy_hazard_alerts_the_car_with_the_voice_off_too():
    js = cockpit_source()
    assert "if (!state.toggles.voice) { toast(text); if (urgent && driveActive) carPost({ kind: 'hazard', title: text }); }" in js


def test_a_request_from_the_car_that_fails_says_why_on_the_car(maps):
    """A loop or a place the phone couldn't plan, or a report with no fix, left the car silent; the reason goes there now."""
    first, none, long = maps["notice"]
    assert first == {"kind": "notice", "titles": ["Couldn't get your location."]}, "the reason only, never the phone's advice"
    assert none is None and long["titles"][0].startswith("Loops use") and len(long["titles"][1]) <= 48
    js = cockpit_source()
    assert "if (car.echo > 0 && !action && window.ApexCarPlay) carPost(ApexCarPlay.noticeMessage(msg));" in js
    for asked in ("carAsked(() => routeToPlace(", "carAsked(() => loop({ minutes: m.minutes }))", "carAsked(() => reportHazard(m.kind, null, true))"):
        assert asked in js
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert 'case "notice":' in swift and "func showNotice(titles: [String])" in swift and "CPAlertTemplate(titleVariants: titles" in swift


def test_the_cars_search_puts_your_own_places_first():
    """As the phone's Where to? does while typing (U-19): Home, a saved route or a time attack by name, then the map's."""
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert "ApexCar.shared.places.filter { $0.name.localizedCaseInsensitiveContains(q) }" in swift
    assert "done(mine + found)" in swift and "if let ref = item.userInfo as? PlaceRef { open(place: ref.place); return }" in swift
