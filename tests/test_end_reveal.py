"""The first run and the drive-ended card (design pass "first and last").

web/end_reveal.js: the driven line beside the Score, the facts as a ledger, the count up to a number that is known.
web/first_run.js: where the red dot waits and moves on the welcome's drawn road while the strip calls the corners.
The rule both keep: nothing is invented (the count never passes the number, and has none without one), and the page at
rest is the whole page (every animation is a `from` with a backwards fill, so reduced motion leaves nothing hidden)."""
import json
import os
import re
import shutil
import subprocess

import pytest

from tests.page_source import cockpit_source

NODE = shutil.which("node")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1];
const E = require(R + '/web/end_reveal.js'), F = require(R + '/web/first_run.js'), Fmt = require(R + '/web/format.js');
const road = []; for (let i = 0; i < 300; i++) road.push([-84.29 + Math.sin(i / 40) * 0.0015, 35.36 + i * 5 / 110540]);
const g = E.glyph([road]);
const nums = g.d[0].match(/-?\d+(\.\d+)?/g).map(Number);
const lines = ['36 mi · 46 min · 30 corners', '0.9 mi · 2 min', '112 km · 1 h 12 min · 1 corner', ''];
const R5 = F.rests([0.13, 0.24, 0.37, 0.52, 0.72]);
console.log(JSON.stringify({
  size: E.SIZE, min: Math.min(...nums), max: Math.max(...nums), from: g.from, to: g.to, points: g.d[0].split('L').length,
  none: [E.glyph([]), E.glyph(null), E.glyph([[[1, 2]]]), E.glyph([[[NaN, 1], [2, NaN]]])],
  two: E.glyph([road.slice(0, 100), road.slice(150)]).d.length,
  cells: lines.map((l) => E.cells(l)),
  back: lines.map((l) => E.cells(l).map((c) => c.map((p) => (p.n != null ? p.n : p.u)).join('')).join(' · ')),
  facts: Fmt.factsLine({ len_m: 2000, secs: 4320, corners: 3 }),
  count: [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1, 2, -1].map((p) => E.countAt(p, 673)),
  unknown: [E.countAt(0.5, null), E.countAt(0.5, NaN), E.countAt(0.5, undefined)],
  zero: E.countAt(0.5, 0), ms: E.COUNT_MS,
  rests: R5, legs: [0, 1, 2, 4, 5, 6, 10].map((k) => F.leg(k, R5)), empty: F.leg(3, []), move: F.MOVE_MS,
}));
"""


@pytest.fixture(scope="module")
def out():
    if NODE is None:
        pytest.skip("node not installed")
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_driven_line_fits_its_box_and_starts_and_ends_where_the_drive_did(out):
    assert 0 <= out["min"] and out["max"] <= out["size"]
    # north up: the drive ran north, so it starts at the bottom and ends at the top
    assert out["from"][1] > out["to"][1] and out["from"][1] <= out["size"] - 9 and out["to"][1] >= 9
    assert 100 <= out["points"] <= 302
    assert out["none"] == [None, None, None, None], "nothing to draw is nothing drawn"
    assert out["two"] == 2, "a drive in two runs (a gap in the fixes) is two lines, never joined across the gap"


def test_the_ledger_is_the_facts_line_and_nothing_else(out):
    assert out["cells"][0] == [[{"n": "36"}, {"u": " mi"}], [{"n": "46"}, {"u": " min"}], [{"n": "30"}, {"u": " corners"}]]
    assert out["cells"][2][1] == [{"n": "1"}, {"u": " h "}, {"n": "12"}, {"u": " min"}]
    assert out["cells"][3] == []
    lines = ["36 mi · 46 min · 30 corners", "0.9 mi · 2 min", "112 km · 1 h 12 min · 1 corner", ""]
    assert out["back"] == lines, "the cells joined are the line: no word added or dropped"
    assert out["cells"] and all("n" in c[0] for c in __import__("json").loads(json.dumps(out["cells"][0])))
    # the real helper's line goes through whole
    assert re.fullmatch(r"[\d.]+ (mi|km) · 1 h 12 min · 3 corners", out["facts"])


def test_the_count_never_passes_the_number_and_has_none_without_one(out):
    c = out["count"]
    assert c[0] == 0 and c[6] == 673 and c[7] == 673 and c[8] == 0
    assert c == sorted(c[:7]) + c[7:], "it only rises"
    assert all(isinstance(v, int) and 0 <= v <= 673 for v in c)
    assert c[3] > 673 / 2, "eased out: most of the way by half time"
    assert out["unknown"] == [None, None, None], "no number, no count"
    assert out["zero"] == 0 and 600 <= out["ms"] <= 900


def test_the_dot_waits_before_the_corner_the_strip_calls(out):
    r = out["rests"]
    assert r[0] == 0 and r == sorted(r)
    for j, f in enumerate([0.13, 0.24, 0.37, 0.52, 0.72]):
        assert r[j] < f, "the dot is short of the corner being called"
    legs = out["legs"]
    assert legs[0] == {"from": 0, "to": 0, "out": False}
    assert legs[1] == {"from": r[0], "to": r[1], "out": False} and legs[3] == {"from": r[3], "to": r[4], "out": False}
    assert legs[4] == {"from": r[4], "to": 1, "out": True} and legs[6]["out"], "when the calls come round the dot runs out to the road's end"
    assert legs[5] == legs[1]
    assert out["empty"] == {"from": 0, "to": 0, "out": False}
    assert out["move"] < 1800, "the dot arrives before the next call"


def page():
    return open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()


def test_the_page_at_rest_is_whole():
    """Every keyframe of the welcome, the permission sheet and the end card is a `from` only (or the pen's dash, which ends
    undashed), played with a backwards fill: with no animation at all (reduced motion, a throttled page) nothing is hidden."""
    html = page()
    frames = dict(re.findall(r"@keyframes ((?:ob|end)-[a-z]+) \{(.*?\})\s*\}", html))
    assert {"ob-home", "ob-rise", "ob-fade", "ob-pen", "ob-pop", "end-pen", "end-rule", "end-rise", "end-pop", "end-thump", "end-ink"} <= set(frames)
    for name, body in frames.items():
        if name in ("ob-pen", "end-pen"):
            assert "to { stroke-dasharray: 1; stroke-dashoffset: 0; }" in body
        elif name in ("end-wait", "end-undo"):
            continue                                                  # the waiting dot's pulse; the drive bar's own
        else:
            assert body.strip().startswith("from") and " to " not in body, name
    for rule in re.findall(r"^\s*(?:#onboard\.ob-go|\.end-card\.(?:pen|landed)|#permSheet\.show \.perm-row)[^{]*\{ animation: ([^}]*)\}", html, re.M):
        assert "backwards" in rule or "end-thump" in rule, rule      # the thump runs from a larger size: never hidden
    assert "@media (prefers-reduced-motion: reduce) { #onboard, #onboard * { animation: none !important; transition: none !important; } }" in html
    assert ".end-card, .end-card *, .end-card *::before, .end-card *::after { animation: none !important; }" in html
    assert "#onboard.ob-skip, #onboard.ob-skip * { animation: none !important; }" in html, "a touch ends the drawing"


def test_the_welcome_keeps_its_keys_and_asks_for_nothing():
    html, src = page(), cockpit_source()
    ob = html[html.index('<div class="overlay" id="onboard"'):html.index('<div class="overlay dim" id="permSheet"')]
    assert '<button class="rec-key" id="obNext"><i></i>Start</button>' in ob and 'id="obAlt">Watch a replay</button>' in ob
    assert ob.count("<button") == 2 and "Sign in" not in ob and "data-apple-signin" not in ob
    assert ob.count('class="ob-apex"') == 5 and 'class="ob-line" pathLength="1"' in ob and 'class="ob-you"' in ob
    # the keys are not part of the drawing: no rule of the welcome animates them
    assert not re.search(r"#onboard\.ob-go [^{]*(\.stack|rec-key|#obNext|#obAlt|linkbtn)", html)
    # location is still asked by Start (finish), never by the welcome opening
    run = src[src.index("    function runOnboarding() {"):src.index("    setTimeout(() => health.flush(")]
    assert "const finish = () => { flag('apex.onboarded', '1'); ob.classList.remove('show'); askLocation(); };" in run
    assert run.count("askLocation()") == 1 and "ApexFirstRun.attach(ob)" in run
    assert "if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(tick, 1800);" in run, "still under reduced motion"


def test_the_permission_sheet_says_what_it_said():
    html, src = page(), cockpit_source()
    sheet = html[html.index('<div class="overlay dim" id="permSheet"'):html.index('<script src="lazy.js" defer>')]
    for label, why in (("Location", '<span id="permLoc">to call corners ahead</span>'), ("Motion", '<span id="permMot">to feel bumps and surface</span>'),
                       ("Screen on", "<span>while you drive</span>"), ("Mount", "in a holder, any way up.")):
        assert f"<b>{label}</b>" in sheet and why in sheet
    assert sheet.count('class="perm-row') == 4 and 'class="perm-row mount-row" style="--i:3" hidden' in sheet
    assert '<p id="permNote">Your drive stays on this phone.</p>' in sheet and 'id="permNo">Not now</button>' in sheet
    assert "$('permGo').className = locDenied ? 'ink-btn solid' : 'rec-key';" in src, "red is go; the way to Settings is ink"


def test_the_card_counts_only_a_known_number():
    src = cockpit_source()
    opened = src[src.index("    function endCardOpen("):src.index("    function endCardScored(")]
    scored = src[src.index("    function endCardScored("):src.index("    function showEndCard(")]
    assert "ApexEndReveal.open(" in opened and "ApexEndReveal.land(" not in opened, "no count while the drive is being scored"
    assert "ApexEndReveal.land(endEl(), { score: none ? null : c.ds.score" in scored
    # the number in the page is written before the count is laid over it
    assert scored.index("$('endScore').textContent = none ?") < scored.index("ApexEndReveal.land(")
    js = open(os.path.join(ROOT, "web", "end_reveal.js"), encoding="utf-8").read()
    assert "textContent" not in js[js.index("  function land("):], "the reveal never writes the score's text"
    html = page()
    assert '<i class="end-glyph" id="endGlyph" aria-hidden="true"></i>' in html
    for key in ('id="endShare"', 'id="endLogKey"', 'id="endStage"', 'id="endAgain"', 'id="endLog"', 'id="endShareLink"', 'id="endDone"',
                'id="endName"', 'id="endMeta"', 'id="endScore"', 'id="endUsual"', 'id="endFeel"', 'id="endLine"', 'id="endPortrait"'):
        assert html.count(key) == 1, key
