"""Panel round 2, build A: the drive screen tells the truth.

- One red that means act now (IN-3, PR-2, TH-2, GR-1): the signal colour is the warning's alone; readings are ink; the
  warning is two channels (colour plus shape and word) and says a plain sentence; the Sight plate is no limit sign.
- Road feel shown (HE-1, LA-3): Bank reads "--" until measured, never +0.0°.
- Explain behind a tap (PR-1, SO-4): parked or in a replay only.
The page itself is checked in a browser by e2e/smoke.js ("one red that means act now")."""
import json
import os
import re
import shutil
import subprocess

import pytest
from tests.page_source import cockpit_source

NODE = shutil.which("node")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")


def read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


RUNNER = r"""
const R = process.argv[1];
const I = require(R + '/web/instruments.js'), CP = require(R + '/web/carplay.js'), K = require(R + '/web/theme_contract.js');
const fs = require('fs');
const root = { localStorage: { getItem: () => null, setItem() {} }, document: { documentElement: { style: { setProperty() {} }, dataset: {} } } };
new Function('window', 'document', fs.readFileSync(R + '/web/themes.js', 'utf8'))(root, root.document);
const T = root.ApexThemes.THEMES, rb = T.roadbook;
const d = (o) => ({ speedMph: 40, paceMph: null, sightMph: null, sightOpen: false, sightQuiet: false, ...o });
console.log(JSON.stringify({
  short: [I.sightShort(d({ sightMph: 20 })), I.sightShort(d({ sightMph: 45 })), I.sightShort(d({ sightMph: 39.5 })), I.sightShort(d({ sightMph: 20, sightOpen: true })),
          I.sightShort(d({ sightMph: 20, sightQuiet: true })), I.sightShort(d({ sightMph: 50, paceMph: 30 })), I.sightShort(d({ speedMph: null, sightMph: 20 }))],
  value: [I.sightValue(d({ sightMph: 50, paceMph: 30 })), I.sightValue(d({})), I.sightValue(d({ sightMph: 50, sightQuiet: true }))],
  slow: [I.slowLine(45), I.slowLine(44.6), I.slowLine(null)],
  bank: [I.bankText(null), I.bankText(undefined), I.bankText(NaN), I.bankText(0), I.bankText(-0.04), I.bankText(4.26), I.bankText(-2.5)],
  gate: [I.explainAllowed({ live: false, speedMps: 30 }), I.explainAllowed(null), I.explainAllowed({ live: true, speedMps: 0 }), I.explainAllowed({ live: true, speedMps: 1.2 }),
         I.explainAllowed({ live: true, speedMps: 1.5 }), I.explainAllowed({ live: true, speedMps: 25 }), I.explainAllowed({ live: true, speedMps: null })],
  explain: Object.fromEntries(Object.entries(I.EXPLAIN).map(([k, e]) => [k, { title: e.title, what: e.what, how: e.how,
    now: e.now({ speedMph: 41.6, limitMph: null, sightMph: 45, paceMph: null, camberDeg: null, score: null, tripMi: 1.25, roadName: '' }, 'mph') }])),
  tag: [CP.sightTag(CP.sightMessage(45, false, 30, 'mph')), CP.sightTag({ text: '45', unit: 'MPH', short: true }), CP.sightTag(CP.sightMessage(null, true)),
        CP.sightTag(CP.sightMessage(null)), CP.sightTag(null)],
  themes: Object.fromEntries(Object.entries(T).map(([k, t]) => [k, { check: K.check(t), day: t.day, night: t.night }])),
  redRoute: K.check({ ...rb, day: { ...rb.day, route: rb.day.signal } }),
  faintSignal: K.check({ ...rb, day: { ...rb.day, signal: '#E8DCC8' } }),
  oldFaceDim: K.check({ ...rb, day: { ...rb.day, faceDim: '#736A5A' } }),
  accents: Object.fromEntries(Object.entries(root.ApexThemes.ACCENTS).map(([k, a]) => [k, ['day', 'night'].map((m) => K.apart(a[m].route, rb[m].signal))])),
  apart: K.APART, floor: K.SIGNAL_FLOOR, alarm: K.ALARM,
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_one_alarm_is_faster_than_sight(out):
    # over Sight by more than 1; not when Open, not at a crawl, not with no speed. Sight is the sight line only (panel
    # round 2 SO-1, web/vocabulary.js): the corner's pace has its own mark on the dial, so 40 against Sight 50 is no alarm
    assert out["short"] == [True, False, False, False, False, False, False]
    assert out["value"] == [50, None, None]
    # GR-1: the plain sentence it says when it fires; nothing to say with no value
    assert out["slow"] == ["Slow to 45 for what you can see.", "Slow to 45 for what you can see.", ""]


def test_bank_is_dashes_until_measured(out):
    """HE-1 / LA-3: BANK +0.0° for twenty minutes read as measured; unknown is "--" in the same slot."""
    assert out["bank"] == ["BANK --", "BANK --", "BANK --", "BANK 0.0°", "BANK 0.0°", "BANK +4.3°", "BANK -2.5°"]


def test_explain_only_parked_or_in_a_replay(out):
    """PR-1 / SO-4: a replay or the idle map explains; a live drive only under 3 mph with a speed to prove it."""
    assert out["gate"] == [True, True, True, True, False, False, False]


def test_every_instrument_says_what_it_is_and_how_it_is_measured(out):
    js = read("web", "instruments.js")
    keys = set(re.findall(r"dataset\.explain = '(\w+)'", js)) | {"meters", "gball"}   # the meter's two, by the theme's renderer
    assert {"speed", "limit", "sight", "score", "trip", "road", "clear"} <= keys
    assert keys <= set(out["explain"]), keys - set(out["explain"])
    for k, e in out["explain"].items():
        assert e["title"] and 20 <= len(e["what"]) <= 220 and 10 <= len(e["how"]) <= 220, k   # short: read parked, in one go
    ex = out["explain"]
    assert "never a target" in ex["sight"]["what"] and "SLOW" in ex["sight"]["how"]
    assert ex["gball"]["now"] == "BANK --" and "calibrated" in ex["gball"]["how"]
    assert ex["score"]["now"] == "--" and ex["limit"]["now"] == "--" and ex["speed"]["now"] == "42 mph" and ex["sight"]["now"] == "45 mph"
    assert ex["road"]["now"] == "--" and ex["trip"]["now"] == "1.3"


def test_the_sight_plate_names_itself(out):
    """TH-2 / IN-3: "SIGHT 45", no unit; faster than it "SLOW"; OPEN and unknown draw nothing."""
    a, b, o, n, none = out["tag"]
    assert a == {"label": "SIGHT", "text": "45", "short": False}
    assert b == {"label": "SLOW", "text": "45", "short": True}
    assert o is None and n is None and none is None


def test_no_reading_wears_the_warning_colour(out):
    """IN-3 / PR-2: the contract keeps the route and the calm ribbon apart from the signal, the signal over 3:1 on the panel,
    and the Roadbook day pencil over 4.5:1 on the paper (it was 4.22:1)."""
    for tid, t in out["themes"].items():
        assert t["check"] == [], (tid, t["check"])
        for mode in ("day", "night"):
            assert t[mode]["route"].upper() != t[mode]["signal"].upper(), (tid, mode)
    assert any("route is the warning's colour" in m for m in out["redRoute"])
    assert any("signal on panel" in m for m in out["faintSignal"])
    assert any("faceDim on panel" in m for m in out["oldFaceDim"])
    assert out["themes"]["roadbook"]["day"]["faceDim"] == "#665E51"
    assert all(min(v) >= out["apart"] for v in out["accents"].values()), out["accents"]   # a cosmetic accent is never the alarm
    assert out["floor"] == 3 and out["alarm"]["channels"] == ["colour", "shape", "word"]


def test_readings_are_ink_on_the_binnacle():
    js, html = read("web", "instruments.js"), cockpit_source()
    dials = js[js.index("  function speedDial("):js.index("  function readouts(")]
    assert "var(--accent)" not in dials, "the needle, the pace mark, the ball, its trail and Bank are readings"
    assert dials.count("var(--signal)") == 1 and "d.speedMph > d.paceMph + 1 ? 'var(--signal)'" in dials, "only the needle over the pace"
    assert ".ro-sight b { color: var(--panel-ink); }" in html and ".ro-eye { display: block; flex: none; color: var(--panel-ink); }" in html
    assert ".dial-digital.small { font-size: 36px; fill: var(--face-ink); }" in html and ".dial-digital.small.unk { fill: var(--face-dim); }" in html
    assert ".dbstat b { color: var(--panel-ink); }" in html, "the Rec dot"
    assert "fill=\"${c.panelInk}\"/></svg>`;   // panel round 2: a position, in ink" in html, "the phone's arrow"
    assert "fill=\"${C.panelInk}\"/></svg>`;   // panel round 2: a position, in ink" in read("web", "carmap.js"), "the car's arrow"
    assert "accent: palette.plateInk)" in read("CarPlay", "ApexCarMap.swift")
    assert ".rb-mods i.warn { color: var(--signal); }" in html, "a warning word is the act-now colour in every theme and accent"
    # Billet's numerals glow in its ink; red is the warning's
    billet = html[html.index('html[data-theme="billet"] .rb-dist b'):html.index("html[data-theme=\"billet\"] .key")]
    assert "color: var(--accent)" not in billet and "fill: var(--accent)" not in billet


def test_the_warning_is_two_channels_and_a_sentence():
    js, html = read("web", "instruments.js"), cockpit_source()
    ro = js[js.index("  function readouts("):js.index("  function odometer(")]
    assert "sight.c.classList.toggle('short', s.short);" in ro and "setT(sightLabel, s.short ? 'SLOW' : 'Sight');" in ro
    assert "class: 'ro-eye-bar'" in ro, "the bar through the eye"
    css = html[html.index("html .readouts .ro.ro-sight.short {"):]
    css = css[:css.index("}")]
    assert "border: 2px solid var(--signal)" in css and "border-image: repeating-linear-gradient(45deg" in css, "the hatched edge"
    assert ".ro-sight.short .ro-eye .ro-eye-bar { display: inline; }" in html
    assert ".ds-note.alarm { color: var(--signal); }" in html and '.ds-note.alarm::before { content: "\\25B2\\00A0"; }' in html
    alarm = html[html.index("    function sightAlarm(d, live) {"):]
    alarm = alarm[:alarm.index("\n    }\n")]
    assert "live && Inst.sightShort(d)" in alarm and "haptic('hazard')" in alarm
    assert "driveNote(Inst.slowLine(v), { alarm: true, ms: 3000 })" in alarm
    assert "sightAlarm(d, !!live);" in html
    note = html[html.index("    function driveNote(msg, opts = {}) {"):]
    assert "n.classList.toggle('alarm', !!opts.alarm);" in note[:600] and "opts.ms || DRIVE_NOTE_MS" in note[:1200]


def test_the_phone_plate_is_the_cars():
    html = cockpit_source()
    paint = html[html.index("    function paintSight(m, live) {"):]
    paint = paint[:paint.index("    function drawPuck()")]
    assert "const tag = ApexCarPlay.sightTag(m);" in paint and "sightEl.hidden = !tag;" in paint
    assert "tag.short ? SIGHT_EYE_BARRED : SIGHT_EYE" in paint and "m.unit ? [el('small'" not in paint
    css = html[html.index(".sight-tag { pointer-events: none;"):html.index(".sight-tag[hidden]")]
    assert "border-radius: 999px" in css and ".sight-tag.short { background: var(--signal);" in css


def test_bank_and_roughness_are_measured_or_unknown():
    html = cockpit_source()
    assert "camber = L.calibration === 'locked' && Number.isFinite(L.camber_deg) ? L.camber_deg : null;" in html
    assert "track.roughG && Number.isFinite(track.roughG[idx]) ? track.roughG[idx] : null);" in html
    assert "track.roughG[idx] : 0)" not in html, "a replay's unknown roughness is never a smooth 0"
    js = read("web", "instruments.js")
    g = js[js.index("  function gDial("):js.index("  function sightValue(")]
    assert "setT(bankTxt, bankText(d.camberDeg));" in g and "bankTxt.classList.toggle('unk', !banked);" in g


def test_explain_is_a_tap_on_the_instrument_not_a_screen():
    html = cockpit_source()
    assert 'id="explainCard" role="dialog" aria-modal="true" aria-labelledby="explainTitle"' in html
    op = html[html.index("    function openExplain(key) {"):]
    op = op[:op.index("\n    }\n")]
    assert "if (!e || !explainGate()) return false;" in op, "nothing while driving"
    assert "if (live && explainOpen() && !explainGate()) closeExplain();" in html, "it closes as the car moves off"
    assert "for (const id of ['cluster', 'notes'])" in html and "ev.target.closest('button, a')" in html
    # no new first-run screen (TO's veto): the sheet opens only from a tap on an instrument
    assert html.count("openExplain(") == 2
