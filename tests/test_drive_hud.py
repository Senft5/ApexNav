"""The drive screen, "Vetta Line" (design pass 2026-11-10, docs/CALL_SHEET.md).

Roadbook's cluster is one hero speed over a ruled line (instruments.js mountLine, theme.cluster 'line'); the other looks
keep their three dials. What is pure is checked here: the count-in's curve, which theme gets which cluster, the contract's
renderer lists, and the page's rules for motion (once, short, and nothing left hidden when motion is off). The rendered
screen is e2e/smoke.js "the drive screen, Vetta Line…".
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
INST = (ROOT / "web" / "instruments.js").read_text(encoding="utf-8")
BLOCK = HTML[HTML.index('The drive screen, "Vetta Line"'):HTML.index("The opening cover (web/boot.js)")]


def _node(script):
    out = subprocess.run([NODE, "-e", script], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_count_in_rises_once_to_the_reading_and_is_a_cut_when_motion_is_off():
    out = _node(r"""
const I = require('./web/instruments.js');
const at = [0, 50, 100, 200, 350, 500, 650, 699, 700, 701, 5000].map((ms) => I.countIn(ms, false));
console.log(JSON.stringify({ ms: I.COUNT_IN_MS, at, still: [0, 100, 699].map((ms) => I.countIn(ms, true)), odd: [NaN, -5, undefined, Infinity].map((ms) => I.countIn(ms, false)), advance: I.ADVANCE_MS }));
""")
    assert 600 <= out["ms"] <= 900, "a line being drawn: 600 to 900 ms"
    at = out["at"]
    assert at[0] == 0 and at[8:] == [1, 1, 1], at
    assert all(b > a for a, b in zip(at[:8], at[1:8])), "it only ever rises: %r" % at
    assert all(0 <= v <= 1 for v in at), "never past the reading (no overshoot on a number you read): %r" % at
    assert at[4] > 0.8, "eases out: most of the way by half time, so the last digits settle slowly: %r" % at
    assert out["still"] == [1, 1, 1], "reduced motion: the reading at once"
    assert out["odd"] == [1, 1, 1, 1], "a bad clock never hides the speed"
    assert 220 <= out["advance"] <= 900


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_roadbook_has_the_line_cluster_and_the_other_looks_keep_their_dials():
    out = _node(r"""
const vm = require('node:vm'), fs = require('node:fs');
const el = { dataset: {}, style: { setProperty() {} } }, b = { window: {}, document: { documentElement: el } };
vm.runInNewContext(fs.readFileSync('web/themes.js', 'utf8'), b);
const T = b.window.ApexThemes, C = require('./web/theme_contract.js');
const grant = T.fromGrant({ id: 'plain', label: 'Plain', day: T.THEMES.roadbook.day, night: T.THEMES.roadbook.night, map: T.THEMES.roadbook.map, renderers: { dial: 'line', meter: 'gball', strip: 'roadbook' } });
console.log(JSON.stringify({ themes: Object.fromEntries(Object.entries(T.THEMES).map(([id, t]) => [id, { cluster: t.cluster, dial: t.renderers.dial, problems: C.check(t) }])),
  known: T.KNOWN_RENDERERS.dial, contract: C.RENDERERS.dial, grant: grant && { cluster: grant.cluster, dial: grant.renderers.dial, problems: C.check(grant) } }));
""")
    assert out["themes"]["roadbook"] == {"cluster": "line", "dial": "line", "problems": []}
    for look in ("tapedeck", "billet"):
        assert out["themes"][look]["cluster"] == "dials" and out["themes"][look]["dial"] != "line" and out["themes"][look]["problems"] == [], look
    assert "line" in out["known"] and out["known"] == out["contract"]
    # a granted theme that names the line dial is drawn in the three-dial layout (the name falls back to the printed dial there)
    assert out["grant"] == {"cluster": "dials", "dial": "line", "problems": []}
    assert "line: (el) => speedDial(el, true)" in INST
    assert "theme.cluster === 'line' ? mountLine(el, theme) : mountDials(el, theme)" in INST


def test_the_line_cluster_keeps_every_part_the_three_dials_had():
    """Tests and cockpit.js reach the parts by class; the redesign moves them, it does not drop one."""
    body = INST[INST.index("  function mountLine("):INST.index("  function mountCluster(")]
    for part in ("'dial dial-speed'", "'cluster-center'", "'dial dial-g'", "'speed-line'", "'ledger'", "readouts(ro)", "odometer(ledger, false)", "gDial(gg, true, true)",
                 "'trip-peek'", "'dna-arch'", "'g-score'", "'SCORE'", "named(el)", "roadType.hidden = !(d.routeOnly || d.sector || name)"):
        assert part in body, part
    for key in ("sp.dataset.explain = 'speed'", "gg.dataset.explain = 'gball'", ".dataset.explain = 'trip'", "roadType.dataset.explain = 'road'", "sc.dataset.explain = 'score'"):
        assert key in body, key
    line = INST[INST.index("  function lineSpeed("):INST.index("  function mountLine(")]
    # unknown stays unknown: no speed is "--", and a mark with no value is not drawn
    assert "setT(digital, live ? Math.round(shown) : '--')" in line
    assert "if (mph == null || !isFinite(mph)) { setS(node, 'display', 'none'); return; }" in line
    # readings are ink; only being over the corner's pace turns the line's end to the signal (PR-2)
    assert "tip.classList.toggle('over', live && d.paceMph != null && d.speedMph > d.paceMph + 1)" in line
    assert ".sl-tip.over circle { fill: var(--signal); }" in BLOCK and ".sl-fill { stroke: var(--panel-ink);" in BLOCK
    # the count-in runs from the first reading only: a speed that drops to nothing and comes back starts it again
    assert "if (!live) since = null; else if (since == null) since = now;" in line


def test_motion_is_short_runs_once_and_leaves_nothing_hidden():
    # every animation in the block: at most 1400 ms with its delay, on the arrive curve or linear, and never fill-mode forwards
    # holding a from-state (backwards only, or both with a visible end)
    uses = re.findall(r"animation: ([\w-]+) (\d+(?:\.\d+)?)(ms|s) ([^;]+);", BLOCK)
    assert {u[0] for u in uses} >= {"hud-rise", "hud-drop", "hud-ring", "hud-seek", "rb-advance", "hud-pen", "hud-head"}, uses
    for name, n, unit, rest in uses:
        ms = float(n) * (1000 if unit == "s" else 1)
        delay = sum(float(x) for x in re.findall(r" (\d+)ms", " " + rest))
        if name == "hud-seek":
            assert "infinite" in rest, "the searching stroke runs only while there is no fix"
            continue
        assert ms + delay <= 1400, (name, ms, delay)
        assert "infinite" not in rest and ("backwards" in rest or "both" in rest), (name, rest)
    assert "#app.live > .binnacle, #app.replaying > .binnacle { animation: hud-rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }" in BLOCK
    # the from-states live in keyframes only, so with animations off (the page's reduced-motion rule) every part is whole
    assert "@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms !important; animation: none !important; } }" in HTML
    for frames in re.findall(r"@keyframes (?:hud-[\w]+|rb-advance) \{(.*?)\}\s*\n", BLOCK, flags=re.S):
        assert "to {" not in frames or "opacity: 0;" not in frames.split("to {")[1], frames
    rules_outside = re.sub(r"@keyframes [\w-]+ \{.*?\}\s*\n", "\n", BLOCK, flags=re.S)
    assert "stroke-dashoffset" not in rules_outside and "opacity: 0;" not in rules_outside and "translateY(100%)" not in rules_outside
    # the seeking line is only for a drive with no sample kept yet; the markup starts there and cockpit.js moves it on
    assert 'id="driveBar" data-state="seek" hidden' in HTML
    cockpit = (ROOT / "web" / "cockpit.js").read_text(encoding="utf-8")
    assert "const ds = s.gps === 'denied' ? 'off' : zoned ? 'zone' : r && r.samples > 0 ? 'rec' : 'seek';" in cockpit


def test_colours_come_from_tokens_and_nothing_is_under_13_px():
    assert not re.search(r"#[0-9a-fA-F]{3,8}\b", re.sub(r"#[a-zA-Z][\w-]*", "", BLOCK)), "no hard-coded colour in the block"
    assert "rgb(" not in BLOCK and "rgba(" not in BLOCK
    sizes = [float(x) for x in re.findall(r"font-size: (\d+(?:\.\d+)?)px", BLOCK)] + [float(x) for x in re.findall(r"font: \d+ (\d+)px", BLOCK)]
    assert sizes and min(sizes) >= 13, sizes
    assert ".dbstat b { color: var(--panel-ink); }" in HTML, "the Rec dot stays ink (PR-2)"
