"""U-103 (docs/design/REVIEW4_CHECK.md): the island's compact word is one the driver reads elsewhere. A square right read
"RSQ" and off route "OFF" (which also reads as recording off); now a corner is its code as the car map's plates print it,
a junction or hazard its own word, off route the status line's words."""
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
const html = ['index.html', 'cockpit.js', 'lazy.js'].map((f) => { try { return require('fs').readFileSync(process.argv[1] + '/web/' + f, 'utf8'); } catch (_) { return ''; } }).join('\n');
const fn = (name) => { const a = html.indexOf(`    function ${name}(`); return html.slice(a, html.indexOf('\n    }', a) + 6); };
globalThis.ApexPlainNotes = require(process.argv[1] + '/web/plain_notes.js');
const { islandShort, islandWords } = new Function(fn('islandWords') + fn('islandShort') + 'return { islandShort, islandWords };')();
console.log(JSON.stringify({
  square: islandShort({ type: 'corner', dir: 'R', severity: 2, code: 'RSQ', call: 'Square right' }),
  acute: islandShort({ type: 'corner', dir: 'L', severity: 1, code: 'LAC', call: 'Acute left' }),
  graded: islandShort({ type: 'corner', dir: 'L', severity: '4', code: 'L4+', call: 'Left 4 plus' }),
  hairpin: islandShort({ type: 'corner', dir: 'R', severity: 'HP', code: 'RHP', call: 'Right hairpin' }),
  turn: islandShort({ type: 'turn', code: 'Sharp right', call: 'Dry Ridge Rd' }),
  roundabout: islandShort({ type: 'turn', code: 'Roundabout · exit 2', call: 'Main St' }),
  crest: islandShort({ type: 'crest', code: 'CREST', call: 'Crest' }),
  // M-3 (panel round 1): with plain words on, the island prints the strip's plain notation
  plain: [{ type: 'corner', dir: 'R', severity: 2, code: 'RSQ', shape: 'square' }, { type: 'corner', dir: 'L', severity: 1, code: 'LAC', shape: 'acute' },
    { type: 'corner', dir: 'L', severity: '4', code: 'L4+' }, { type: 'corner', dir: 'R', severity: 'HP', code: 'RHP' }, { type: 'crest', code: 'CREST', call: 'Crest' }].map((n) => islandShort(n, 'plain')),
  wrong: islandWords('Wrong way · no signal to reroute'), off: islandWords('Off route'), checking: islandWords('Checking route…'),
}));
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_corners_read_as_the_car_map_plates(out):
    # M-3 (panel round 1): real rally notation, never the internal RSQ / LAC (an acute corner is a hairpin)
    assert out["square"] == "SQ R" and out["acute"] == "LHP"
    assert out["graded"] == "L4+" and out["hairpin"] == "RHP"
    assert out["plain"] == ["SQUARE R", "HAIRPIN L", "OPEN L", "HAIRPIN R", "CREST"]
    car = open(os.path.join(ROOT, "web", "carplay.js"), encoding="utf-8").read()
    assert "text: (P && P.noteCode(e, words))" in car  # the car map's plate, the same code
    assert "islandShort(n, state.noteWords)" in cockpit_source()


def test_junctions_and_hazards_keep_their_words(out):
    assert out["turn"] == "Sharp right" and out["roundabout"] == "Roundabout" and out["crest"] == "CREST"


def test_off_route_says_the_status_lines_words(out):
    assert out["wrong"] == "Wrong way" and out["off"] == "Off route" and out["checking"] == "Checking"
    html = cockpit_source()
    quiet = html[html.index("    function quietActivity("):html.index("    function islandWords(")]
    assert "short: 'OFF'" not in quiet and "islandWords(offRouteText())" in quiet
    assert "SQ`" not in html[html.index("    function islandShort("):html.index("    function pushActivity(")]
