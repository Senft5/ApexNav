"""VoiceOver (panel round 2 AM-1, AM-2, AM-3): what the road book strip and the instruments say (web/say.js), and the
page wiring that shuts closed doors (web/doors.js, index.html). The behaviour in a browser is e2e/smoke.js's VoiceOver flow."""
import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
NODE = shutil.which("node")

RUNNER = r"""
const S = require(process.argv[1] + '/web/say.js');
const n = (call, dist, unit) => ({ call, dist, unit, type: 'corner' });
const out = {
  strip: S.strip([n('Careful, hairpin left, long', '350', 'FT'), n('Easy left', '1.3', 'MI'), n('Crest', '.4', 'KM')]),
  quiet: S.strip(Object.assign([], { quietText: 'Quiet from here. Bumps and cameras only.' })),
  bands: ['340', '360', '420', '80'].map((d) => S.distance(d, 'FT')),
  metres: ['230', '260'].map((d) => S.distance(d, 'M')),
  none: S.distance(null, 'FT'),
  one: S.distance('1', 'MI'),
  inst: S.instruments({ speedMph: 48.4, limitMph: 45, sightMph: 40, paceMph: 50, latG: 0.3, lonG: -0.2, camberDeg: 2.4, score: 812.2, tripMi: 1.52, totalMi: 6.2 }),
  unknown: S.instruments({ speedMph: null, limitMph: null, sightOpen: true, latG: null, lonG: null, score: null, tripMi: null }),
  metric: S.instruments({ speedMph: 80, limitMph: 90, sightMph: 70, paceMph: 70 }, 'km/h', 'km'),
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    if NODE is None:
        pytest.skip("node not installed")
    res = subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_strip_said_in_the_grammars_words(out):
    assert out["strip"] == "Careful, hairpin left, long in 400 feet; then easy left in 1.3 miles; then crest in 0.4 kilometres"
    assert out["quiet"] == "Clear. Quiet from here. Bumps and cameras only."


def test_distance_changes_only_across_a_band(out):
    assert out["bands"] == ["300 feet", "400 feet", "400 feet", "80 feet"]
    assert out["metres"] == ["250 metres", "250 metres"]
    assert out["none"] == ""
    assert out["one"] == "1 mile"


def test_instruments_named_value_first(out):
    i = out["inst"]
    assert i["speed"] == "48 miles per hour, Speed"
    assert i["limit"] == "45 miles per hour, Speed limit"
    assert i["sight"] == "40 miles per hour, Sight, slow down"           # 48 against 40: faster than you can see
    assert i["grip"] == "0.4 g braking and turning left, bank 2 degrees into the turn, Grip"
    assert i["score"] == "812, Vetta Score"
    assert i["trip"] == "1.5 miles of 6.2, Trip"


def test_unknown_is_said_as_unknown(out):
    u = out["unknown"]
    assert u["speed"] == "unknown, Speed" and u["limit"] == "unknown, Speed limit"
    assert u["sight"] == "Open, Sight" and u["grip"] == "unknown, Grip" and u["score"] == "unknown, Vetta Score"
    assert out["metric"]["limit"] == "90 kilometres per hour, Speed limit"


def test_page_wiring():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    cockpit = (WEB / "cockpit.js").read_text(encoding="utf-8")
    inst = (WEB / "instruments.js").read_text(encoding="utf-8")
    doors = (WEB / "doors.js").read_text(encoding="utf-8")
    assert '<script src="doors.js" defer></script>' in html and '<script src="say.js" defer></script>' in html
    assert html.index('src="say.js"') < html.index('src="instruments.js"')
    # AM-1: closed sheets leave the swipe order; open ones make what is behind them inert; the tab bar says which is current
    assert ".sheet, .side-pop { visibility: hidden;" in html and ".edge:not(.open) .edge-panel { visibility: hidden;" in html
    assert "n.inert = true" in doors and "aria-current" in doors and "focus(" in doors
    # AM-2: the strip is a named group with one line said on demand, never a live region over the co-driver
    assert 'id="notes" role="group" aria-label="Road book"' in html
    assert "roadBookSaid(showN)" in cockpit and "aria-live" not in cockpit[cockpit.index("function roadBookSaid"):cockpit.index("function roadBookSaid") + 1200]
    assert 'id="hzPlateDetail" aria-live="off"' in html                    # the plate's distance doesn't re-announce it
    # AM-3: the cluster names its instruments
    assert "u.push(named(el));" in inst and "Say.SIGHT_MEANS" in inst
