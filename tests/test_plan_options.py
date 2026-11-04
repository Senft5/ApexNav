"""The plan flow (CALL_SHEET 2026-11-04): one Options sheet (web/plan_options.js), what is on shown as chips, a loop's level
(web/fun_route.js loopLevelAdjust), and the page's one home for each of them (web/index.html)."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

RUNNER = r"""
const R = process.argv[1] + '/web/';
const O = require(R + 'plan_options.js'), F = require(R + 'fun_route.js');
const none = { avoid: { highways: false, unpaved: false }, prefs: { tight: 0, fast: 0 }, driver: {} };
const lots = { avoid: { highways: true, cameras: true }, prefs: { measured: true, tight: 1, fast: -1 }, driver: { passenger: true, tunnels: true } };
const out = {
  none: O.active(none), lots: O.active(lots), chip: [O.chipLabel(O.active(none)), O.chipLabel(O.active(lots))],
  same: O.changed(O.snapshot(lots), O.snapshot(JSON.parse(JSON.stringify(lots)))),
  moved: O.changed(O.snapshot(lots), O.snapshot({ ...lots, avoid: { highways: true } })),
  from: O.changed(O.snapshot({ ...none, from: '' }), O.snapshot({ ...none, from: 'Knoxville' })),
  // a loop's level: Quick favours the asked length, Long way the corners; Fun changes nothing
  adj: ['quick', 'fun', 'max'].map((l) => [F.loopLevelAdjust({ fun: 60 }, 0, l), F.loopLevelAdjust({ fun: 60 }, 0.3, l), F.loopLevelAdjust({ fun: 60 }, -0.3, l)]),
  pick: ['quick', 'fun', 'max'].map((l) => {
    // two loops built for a 45 mi ask: a twisty 58 mi one and a tamer 46 mi one, scored as buildLoop scores them at Fun
    const loops = [{ name: 'long twisty', fun: { fun: 80 }, off: 13 / 45 }, { name: 'near tame', fun: { fun: 62 }, off: 1 / 45 }]
      .map((d) => ({ ...d, score: F.loopValue(d.fun, 45 * (1 + d.off), 45, 0) }));
    return loops.map((d) => ({ name: d.name, v: d.score + F.loopLevelAdjust(d.fun, d.off, l) })).sort((a, b) => b.v - a.v)[0].name;
  }),
  levels: Object.fromEntries(Object.entries(F.LEVELS).map(([k, v]) => [k, v.label])),
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    p = subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_what_is_on_shows_as_chips(out):
    # finding 5: once Options closes, every option that is on is still in view, ✕ for avoided and ✓ for preferred
    assert out["none"] == [] and out["chip"][0] == "Options"
    assert [x["text"] for x in out["lots"]] == ["✕ Highways", "✕ Cameras", "✓ Measured roads", "✓ Passenger aboard", "✓ Tunnels",
                                                "More hairpins", "Fewer fast bends"]
    assert out["chip"][1] == "Options · 7"
    assert all(x["aria"] and x["key"] for x in out["lots"])


def test_closing_options_plans_again_only_when_something_changed(out):
    assert out["same"] is False and out["moved"] is True and out["from"] is True


def test_a_loop_has_a_level(out):
    q, f, m = out["adj"]
    assert f == [0, 0, 0]                                  # Fun is today's loop ranking, unchanged
    assert q[1] < 0 and q[2] < 0 and q[0] < 0              # Quick: off the asked length costs more, corners count less
    assert m[0] > 0 and m[1] > m[0] - 80 * 0.5 * 0.3 - 1   # Long way: corners count more, the length may run
    assert out["pick"] == ["near tame", "near tame", "long twisty"]    # the level changes which loop wins
    assert out["levels"] == {"quick": "Quick", "fun": "Fun", "max": "Long way"}


def test_each_plan_setting_has_one_home_on_the_page():
    """Finding 4: the level is on the route card only; Avoid, Prefer, the kinds of corners, the start point, presets, GPX and
    loops to fit are in the one Options sheet; Explore is Best roads nearby's list sheet. Nothing of them is left in a More."""
    html = (WEB / "index.html").read_text(encoding="utf-8")
    assert 'id="planMore"' not in html and "For this drive" not in html and "Corner mix" not in html and "stamped" not in html
    card = html[html.index('<section id="routeCard"'):html.index("</section>", html.index('<section id="routeCard"'))]
    assert len(re.findall(r"data-fun=", html)) == 3 and len(re.findall(r"data-fun=", card)) == 3
    opts = html[html.index('id="optSheet"'):html.index("</aside>", html.index('id="optSheet"'))]
    for attr in ('data-avoid="highways"', 'data-avoid="cameras"', 'data-prefer="measured"', 'data-driver="passenger"', 'data-driver="tunnels"',
                 'data-pref-tight="1"', 'data-pref-fast="-1"', 'id="fromInput"', 'id="presetRow"', 'id="presetSaveBtn"', 'id="gpxFile"',
                 'data-loop-min="60"', 'data-fit="calendar"'):
        assert attr in opts, attr
        assert html.count(attr) == 1, attr
    near = html[html.index('id="nearbySheet"'):html.index("</aside>", html.index('id="nearbySheet"'))]
    assert 'data-explore-min="15"' in near and 'id="exploreList"' in near and html.count("data-explore-min=") == 2
    # the dial is one unit, yours (finding 6): five distances, no hours among them
    dial = html[html.index('id="loopDetents"'):html.index("</div>", html.index('id="loopDetents"'))]
    assert len(re.findall(r"data-loop-mi=", dial)) == 5 and "data-loop-min" not in dial


def test_one_name_for_go():
    """Finding 8: the card's go key is Start; the bar's with no route is Just drive; Preview is Fly-through; no Drive it."""
    html = (WEB / "index.html").read_text(encoding="utf-8")
    js = (WEB / "cockpit.js").read_text(encoding="utf-8")
    assert re.search(r'id="routeDriveBtn"><i></i>Start</button>', html)
    assert re.search(r'id="startDrive"[^>]*><i></i>Just drive</button>', html)
    assert re.search(r'id="routePreviewBtn">Fly-through</button>', html)
    assert ">Drive it<" not in html and ">Preview<" not in html
    assert "'Preview ×'" not in js and "el('i'), 'Drive')" not in js


def test_plain_words_for_a_new_driver():
    """Finding 9: the plan flow's words a new driver reads, in web/vocabulary.js: Long way (not Max fun), Kinds of corners
    (not Corner mix), ✕ / ✓ (not stamped), Curvy and Flowing (not TWIST and FLOW), S-bends and Tight corners (not Esses and
    Technical); Sight and Bank keep their instrument names (CarPlay shares them) and say what they are in plain words."""
    p = subprocess.run([NODE, "-e", "const V = require(process.argv[1]); console.log(JSON.stringify({ t: V.TERMS, line: V.plainRoads('Ahead: Esses at 2.4 mi · Technical at 3.4 mi · Flowing sweepers from the start') }))",
                        str(WEB / "vocabulary.js")], capture_output=True, text=True, encoding="utf-8", check=True)
    v = json.loads(p.stdout)
    assert v["line"] == "Ahead: S-bends at 2.4 mi · Tight corners at 3.4 mi · Fast bends from the start"
    t = v["t"]
    assert (t["twist"]["label"], t["flow"]["label"], t["fun"]["values"][2]) == ("Curvy", "Flowing", "Long way")
    assert t["hairpins"]["values"] == ["Fewer", "Any", "More"] and t["fastBends"]["values"] == ["Fewer", "Any", "More"]
    assert t["sight"]["plain"] and t["bank"]["plain"] and t["fun"]["plain"]
    html = (WEB / "index.html").read_text(encoding="utf-8")
    js = (WEB / "cockpit.js").read_text(encoding="utf-8")
    for word in ("Max fun", "Corner mix", "stamped means", "stamped ranks"):
        assert word not in html, word
    assert "['Twist'," not in js and "['Flow'," not in js
