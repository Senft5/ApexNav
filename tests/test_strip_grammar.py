"""REVIEW5 (docs/design/REVIEW5.md) roadmap items 1 and 8: the strip's grammar (words in the head, codes in the next cells,
one height, a landscape strip with words) and the small things (the Road line, the place plate, Tapedeck's limit, the
island's quiet word). The layout itself is checked in a browser by e2e/smoke.js ("theme contract on its side")."""
import json
import os
import re
import shutil
import subprocess

import pytest
from tests.page_source import cockpit_source

NODE = shutil.which("node")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


RUNNER = r"""
const I = require(process.argv[1] + '/web/instruments.js');
const n = (o) => I.stripCode(o);
console.log(JSON.stringify({
  r3: n({ type: 'corner', code: 'R3', call: 'Right 3' }), graded: n({ type: 'corner', code: 'l4+', call: 'Left 4 plus' }),
  hp: n({ type: 'corner', code: 'LHP', call: 'Left hairpin' }), crest: n({ type: 'crest', code: 'CREST', call: 'Crest' }),
  cam: n({ type: 'alpr', code: 'SPD', call: 'Speed camera' }), nocode: n({ type: 'bump', call: 'Big bump, careful' }),
  keep: n({ type: 'turn', dir: 'R', code: 'Keep right', call: 'I-75' }), bear: n({ type: 'turn', dir: 'L', code: 'Bear left', call: '' }),
  sharp: n({ type: 'turn', dir: 'R', code: 'Sharp right', call: 'Main St' }), left: n({ type: 'turn', dir: 'L', code: 'Left', call: 'Elm St' }),
  rbt: n({ type: 'turn', dir: 'O', code: 'Roundabout · exit 2', call: 'Main St' }), rbt0: n({ type: 'turn', dir: 'O', code: 'Roundabout', call: '' }),
  exit: n({ type: 'turn', dir: 'R', code: 'Exit 12A', call: 'I-75' }), exitR: n({ type: 'turn', dir: 'R', code: 'Exit right', call: '' }),
  uturn: n({ type: 'turn', dir: 'U', code: 'U-turn', call: '' }), arrive: n({ type: 'turn', dir: 'A', code: 'Arrive', call: 'Destination' }),
  merge: n({ type: 'turn', dir: 'S', code: 'Merge', call: '' }), odd: n({ type: 'turn', dir: 'R', code: 'Continue onto the long road', call: '' }),
}));
"""


@pytest.fixture(scope="module")
def codes():
    if NODE is None:
        pytest.skip("node not installed")
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_next_cells_print_codes_never_words(codes):
    """U-107: the next cell said "EASY …", "MEDIU…", "CR…"; now the note's code, short and whole."""
    assert codes["r3"] == "R3" and codes["graded"] == "L4+" and codes["hp"] == "LHP"
    assert codes["crest"] == "CREST" and codes["cam"] == "SPD" and codes["nocode"] == "BUMP"
    assert codes["keep"] == "KEEP R" and codes["bear"] == "BEAR L" and codes["sharp"] == "SHARP R" and codes["left"] == "TURN L"
    assert codes["rbt"] == "RBT 2" and codes["rbt0"] == "RBT" and codes["exit"] == "EXIT 12A" and codes["exitR"] == "EXIT R"
    assert codes["uturn"] == "U-TURN" and codes["arrive"] == "ARRIVE" and codes["merge"] == "MERGE" and codes["odd"] == "TURN R"
    assert all(len(v) <= 8 for v in codes.values()), codes


def test_the_renderer_and_the_strip_css():
    js, html = read("web", "instruments.js"), cockpit_source()
    render = js[js.index("  function renderNotes("):js.index("  // Dial cluster")]
    assert "html('b', 'rb-code', box, stripCode(n, notes.words))" in render and "if (i > 0)" in render   # the next cells: the code only
    assert "html('span', 'rb-mods', box)" in render                                         # the modifiers: a row of their own
    # U-107: the head takes the room the codes leave; U-133: one height for every call (and on the welcome)
    assert ".notes-roadbook { display: grid; grid-template-columns: minmax(0, 1fr) auto auto;" in html
    assert ".notes.notes-roadbook { height: calc(var(--safe-top) + 12px + var(--strip-body, 104px));" in html
    assert ".ob-strip .notes.notes-roadbook { height: 92px;" in html
    assert ".rb-code {" in html and "white-space: nowrap" in html[html.index(".rb-code {"):html.index(".rb-code {") + 300]
    # the welcome loop is drawn by the same renderer (cockpit.js OB_NOTES)
    assert "Inst.renderNotes($('obNotes'), look.theme" in html


def test_landscape_strip_and_column():
    """U-106: on its side the strip had no words and the Road line overprinted the Score."""
    html = cockpit_source()
    land = html[html.index("@media (orientation: landscape) and (max-height: 540px) {"):]
    land = land[:land.index("\n    }\n")]
    assert ".notes-roadbook { grid-template-columns: minmax(0, 1fr) auto; } .rb-box:nth-child(3) { display: none; }" in land
    assert ".cluster-dials { grid-template-columns: var(--dial) minmax(0, 1fr);" in land
    assert ".cluster-dials > * { min-width: 0; }" in land
    assert ".cluster-dials > .dial-g { grid-column: 1 / -1;" in land and "--strip-body" in land


def test_road_line_is_held_to_its_column():
    """U-124: a long road name started under the dial (Billet hid its first letter)."""
    html = cockpit_source()
    rule = re.search(r"\.cluster-center > \.dna-arch \{([^}]*)\}", html).group(1)
    assert "justify-self: stretch" in rule and "min-width: 0" in rule and "white-space: normal" in rule
    assert "ellipsis" not in rule and "nowrap" not in rule
    assert 'html[data-theme="tapedeck"] .cluster-center > .dna-arch { white-space: normal; }' in html


def test_tapedeck_prints_the_limit_once():
    """U-129: "LIMIT 70" under the speed beside the Speed Limit sign reading 70."""
    js = read("web", "instruments.js")
    seg = js[js.index("  function sevenSeg("):js.index("  function barMeters(")]
    assert "LIMIT" not in seg.replace("no \"LIMIT 70\" caption", "")


def test_place_plate_one_rule():
    """U-127: the plate over Billet's end card, missing from the idle map after a free drive."""
    html = cockpit_source()
    fn = html[html.index("    function paintPlacePlate("):html.index("    async function refreshPlacePlate(")]
    assert "classList.contains('show')" in fn and "classList.contains('idle')" in fn
    idle = html[html.index("    function paintIdle("):html.index("    function setMode(")]
    assert "paintPlacePlate()" in idle
    assert "hideEndTrail(); paintPlacePlate(); })" in html                 # Done brings it back at once


def test_island_quiet_shows_the_distance_and_scales():
    """U-131: "QUIET" in the compact island was clipped to "QUIE"."""
    widget, html = read("LiveActivity", "ApexLiveWidget.swift"), cockpit_source()
    trailing = widget[widget.index("compactTrailing:"):widget.index("minimal:")]
    assert "context.state.trail" in trailing and ".frame(maxWidth: 44)" in trailing and ".minimumScaleFactor(0.5)" in trailing
    assert "var trail: String? = nil" in read("LiveActivity", "ApexDriveAttributes.swift")
    assert 'trail: dict["trail"] as? String' in read("ApexNavApp.swift")
    quiet = html[html.index("    function quietActivity("):html.index("    function islandWords(")]
    assert "trail: d ? `${d.n} ${d.u}`.toUpperCase() : ''" in quiet
    assert "trail: n ? '' : (q.trail || '')" in html
