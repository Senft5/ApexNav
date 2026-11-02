"""The vocabulary contract (panel round 2: SO-1, RA-3, HE-3; web/vocabulary.js).

One word, one meaning, one place:
- every term is defined once, with a label and a one-line meaning;
- a setting has one home (its switch appears where the contract says, and nowhere else), with the same labels each time;
- a label on two controls is one action (listed with its reason in SHARED), never two;
- "Fun" is a route style, never a number; a drive's corners are every corner, never the Score's count; the map's Sight tag
  and the binnacle's Sight cell are one number.
One set of numbers: one drive gives the same distance, time and corners on every surface, and a year never reads less than
a week inside it. The examples are the real words: the theme cards and the plain-words example come from the call grammar.
"""
import json
import re
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

RUNNER = r"""
const R = process.argv[1] + '/web/';
globalThis.ApexUnits = require(R + 'units.js'); ApexUnits.set('imperial');
globalThis.ApexFormat = require(R + 'format.js');
const V = require(R + 'vocabulary.js'), P = require(R + 'plain_notes.js'), Core = require(R + 'apex_core.js');
const I = require(R + 'instruments.js'), L = require(R + 'voice_lines.js'), CP = require(R + 'carplay.js');
const Y = require(R + 'year_review.js'), W = require(R + 'week_digest.js'), F = globalThis.ApexFormat;
const deps = { plain: P, units: ApexUnits, paceNoteText: Core.paceNoteText, lockup: I.lockup, voiceLines: L };
const out = { terms: V.TERMS, shared: V.SHARED, known: V.KNOWN };
// the examples, in both words modes, for every pack
out.samples = {};
for (const w of ['plain', 'rally']) {
  out.samples[w] = { call: V.sampleCall(w, deps), strip: V.sampleStrip(w, deps), example: V.wordsExample(w, deps), quotes: {} };
  for (const id of Object.keys(L.PACKS)) out.samples[w].quotes[id] = V.sampleQuote(id, w, deps);
}
// what the drive itself says for the sample: plain words through plainChain (Hale's card delivery for Hale), rally
// notes as cockpit.js chainedCall joins the note's call and its distance
const [a, b] = V.SAMPLE;
out.drive = { plain: P.plainChain([a], ApexUnits, { next: b }), plainCard: P.plainChain([a], ApexUnits, { next: b, card: true }),
  rally: `${Core.paceNoteText(a).call}, ${a.link}`, plainHead: P.plainCall(a) };
out.packLines = Object.fromEntries(Object.entries(L.PACKS).map(([k, v]) => [k, Object.values(v.lines)]));
out.cards = Object.fromEntries(Object.entries(L.PACKS).map(([k, v]) => [k, !!v.card]));
// Sight: the tag under the arrow and the binnacle's cell, frame by frame, over a run where the corner's pace is lower than
// the sight line (recording 7: the tag said 50 and the cell 48, the pace)
const f = CP.sightFilter(), frames = [];
for (let i = 0; i < 80; i++) {
  const sight = 52 + 6 * Math.sin(i / 7), pace = 48, speed = 43 + (i > 40 ? 15 : 0), held = f.step({ sight, open: false, speed, limit: null, unit: 'mph' }, i * 250);
  const cell = I.sightCell({ sightMph: held.value, sightOpen: held.open, sightQuiet: false, paceMph: pace, speedMph: speed, sightShort: !!held.msg.short });
  frames.push({ tag: held.msg.text, red: !!held.msg.short, cell: cell.text, cellRed: cell.short });
}
out.sight = frames;
out.sightQuiet = I.sightCell({ sightMph: 50, sightQuiet: true, paceMph: 40, speedMph: 2 });
out.sightOpen = I.sightCell({ sightMph: null, sightOpen: true, paceMph: 40, speedMph: 60 });
// one drive, every surface: 1.3 mi, 2:08, three corners of which the Score counted two (recording 7, tabs 015/016/022)
const MI = 1609.344, len = 1.3 * MI, corners = [[10, 20, 15], [40, 52, 46], [90, 99, 95]];
const summary = { id: 'ct', name: 'Carolina Trace Road', date: '2026-11-02T22:51', len_m: len, secs: 128, n: 420, corners, ds: { score: 793, corners: 2 } };
const logDrive = { ...summary, km: len / 1000, dist: [len], corners: corners.map(([start, end, apex]) => ({ start, end, apex })) };   // analysis.html listDrive
out.surfaces = {
  endCard: F.factsLine({ len_m: summary.len_m, secs: summary.secs, corners: summary.corners.length }),   // cockpit.js End (the save job's summary)
  endCardRecord: F.factsLine({ len_m: len, secs: 128, corners: logDrive.corners.length }),               // cockpit.js showEndCard
  drivePage: F.factsLine({ len_m: logDrive.km * 1000, secs: 128, corners: logDrive.corners }),           // drive_view.js head
  logRow: F.factsLine(logDrive, ['distance', 'corners']),                                                 // analysis.html row
};
const now = Date.parse('2026-11-03T09:00');
const yr = Y.summary([{ ...logDrive, dateKnown: true }], 2026), wk = W.digest([{ ...logDrive, dateKnown: true }], now);
out.year = { line: Y.lines(yr)[0], total: F.distance(yr.m) }; out.week = W.lines(wk)[0];
out.dist = [0.04, 1.3, 9.94, 10, 70.6, 1234.5].map((mi) => F.distance(mi * MI));
out.minutes = [null, 0, 128, 3599, 3600, 4000].map(F.minutes);
out.count = [null, 0, 1, 3].map(F.cornerCount);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    p = subprocess.run([NODE, "-e", RUNNER, str(ROOT)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def _controls(html):
    """(label, identity) for every button and link: identity is its id, or its first data-* attribute and value."""
    found = []
    for m in re.finditer(r"<(button|a)\b([^>]*)>(.*?)</\1>", html, re.S):
        label = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(3))).strip()
        if not label:
            continue
        idm = re.search(r'\bid="([^"]+)"', m.group(2))
        data = re.findall(r'(data-[\w-]+="[^"]*")', m.group(2))
        found.append((label, idm.group(1) if idm else (data[0] if data else m.group(0)[:60])))
    return found


def _code(text):
    """The file without its comments (a // at a line start or after whitespace, and /* */ blocks), so a rule reads code."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    return re.sub(r"(^|\s)//[^\n]*", r"\1", text)


# ---- the contract itself -------------------------------------------------------------------------------------------------

def test_every_term_has_one_label_and_one_meaning(out):
    labels = [t["label"].lower() for t in out["terms"].values()]
    assert len(labels) == len(set(labels)), "a label defined twice"
    for k, t in out["terms"].items():
        assert t["label"] and t["meaning"] and t["meaning"].endswith("."), k
        assert t["kind"] in ("reading", "score", "count", "setting", "action"), k
    for k in ("sight", "score", "bank", "flow", "twist", "fun", "notes", "corners", "distance"):
        assert k in out["terms"], k
    # Fun is a route style: a setting with three stops, never a number
    fun = out["terms"]["fun"]
    assert fun["kind"] == "setting" and fun["values"] == ["Quick", "Fun", "Max fun"] and "Never a number" in fun["meaning"]


def test_every_setting_has_its_one_home():
    """A setting's switch appears as many times as the contract allows (one, unless one choice is offered at two steps of
    one flow), each time with the same labels. Recording 7 had Notes and Voice in Layers and again in the Garage."""
    terms = json.loads(subprocess.run([NODE, "-e", "console.log(JSON.stringify(require(process.argv[1]).TERMS))", str(WEB / "vocabulary.js")],
                                      capture_output=True, text=True, check=True).stdout)
    html = (WEB / "index.html").read_text(encoding="utf-8")
    for k, t in terms.items():
        if t["kind"] != "setting":
            continue
        attr = t["control"]
        tags = re.findall(r"<button\b[^>]*" + re.escape(attr) + r"[^>]*>(.*?)</button>", html, re.S)
        labels = [re.sub(r"<[^>]+>", "", x).strip() for x in tags]
        per = len(t.get("values") or [None])
        assert len(labels) == per * t["homes"], f"{k}: {len(labels)} controls, the contract allows {per * t['homes']}"
        if t.get("values"):
            assert labels == t["values"] * t["homes"], f"{k}: {labels}"


def test_a_label_on_two_controls_is_one_action(out):
    """No label string names two different actions. A label on two controls is listed in SHARED with why it is one
    meaning; KNOWN holds a break already owned elsewhere (and fails once it is fixed, so the list stays true)."""
    shared, known = out["shared"], out["known"]
    actions = {t["label"]: t["ids"] for t in out["terms"].values() if t["kind"] == "action"}
    for page in ("index.html", "analysis.html"):
        by = defaultdict(set)
        for label, ident in _controls((WEB / page).read_text(encoding="utf-8")):
            by[label].add(ident)
        for label, ids in by.items():
            if label in actions and label not in known:
                assert ids <= set(actions[label]), f"{page}: {label!r} on {sorted(ids)}; the contract gives it to {actions[label]}"
            if len(ids) > 1:
                assert label in shared or label in known, f"{page}: {label!r} names {len(ids)} controls {sorted(ids)}: one word, one action"
    index = defaultdict(set)
    for label, ident in _controls((WEB / "index.html").read_text(encoding="utf-8")):
        index[label].add(ident)
    for label in known:
        assert len(index[label]) > 1, f"{label!r} is fixed: take it out of vocabulary.js KNOWN"


def test_no_term_is_used_with_another_meaning():
    """Fun is never a number; a drive's corners never print the Score's count; the examples are never typed sentences."""
    rules = [
        (r"[`'\"]Fun (\$\{|\d)", "Fun as a number (it is the route style)"),
        (r"ds\.corners\}? corners", "the Score's clean-corner count printed as the drive's corners"),
        (r"For example \"[A-Z]", "a typed example sentence (vocabulary.js wordsExample writes it)"),
        (r"TIGHTENS</i>|LEFT 4</b>", "the theme card's hard-coded strip head"),
        (r"Math\.min\(\.\.\.both\)", "the Sight cell taking the corner's pace under the Sight label"),
    ]
    hits = []
    for f in sorted(WEB.glob("*.js")) + sorted(WEB.glob("*.html")):
        code = _code(f.read_text(encoding="utf-8"))
        for pat, why in rules:
            for m in re.finditer(pat, code):
                hits.append(f"{f.name}: {m.group(0)!r}: {why}")
    assert not hits, "\n".join(hits)


# ---- one set of numbers --------------------------------------------------------------------------------------------------

def test_one_drive_says_the_same_numbers_everywhere(out):
    s = out["surfaces"]
    assert s["endCard"] == s["endCardRecord"] == s["drivePage"] == "1.3 mi · 2 min · 3 corners"
    assert s["logRow"] == "1.3 mi · 3 corners"                       # every corner, not the Score's two
    # the year and the week inside it read the same distance (recording 7: "1 mi" over "Your week: 1.3 mi")
    assert out["year"]["line"].startswith("1.3 mi in 1 drive") and out["year"]["total"] == "1.3 mi"
    assert out["week"].startswith("1.3 mi in 1 drive")


def test_the_one_distance_and_time_format(out):
    assert out["dist"] == ["0.0 mi", "1.3 mi", "9.9 mi", "10 mi", "71 mi", "1235 mi"]
    assert out["minutes"] == [None, "0 min", "2 min", "1 h 0 min", "1 h 0 min", "1 h 7 min"]
    assert out["count"] == [None, "0 corners", "1 corner", "3 corners"]


def test_the_sight_tag_and_the_sight_cell_are_one_number(out):
    shown = [x for x in out["sight"] if x["tag"]]
    assert shown, "the tag never showed"
    for x in shown:
        assert x["cell"] == x["tag"], x                              # never 50 on the map and 48 in the binnacle
        assert x["cellRed"] == x["red"], x                           # red together, by the plate's 3 s rule
    assert out["sightQuiet"]["text"] == "--" and out["sightOpen"]["text"] == "Open"


# ---- the real words in the examples (HE-3) ---------------------------------------------------------------------------

def test_the_examples_are_the_words_the_drive_says(out):
    d, sm = out["drive"], out["samples"]
    assert sm["plain"]["call"] == d["plain"] == "Careful, medium right, long, then easy left in a quarter mile"
    assert sm["rally"]["call"] == d["rally"]
    assert sm["plain"]["example"] == f'For example "{d["plain"]}".'
    assert d["rally"] in sm["rally"]["example"]
    # the strip head is the strip's own lockup of the call: words, then the caution and the modifiers under them
    assert sm["plain"]["strip"]["head"] == "Medium right" and [t["text"] for t in sm["plain"]["strip"]["tail"]] == ["careful", "long"]
    assert sm["rally"]["strip"]["head"] == "Right 3"
    assert sm["plain"]["strip"]["dist"] == {"n": "500", "u": "FT"}


def test_every_theme_card_quote_is_a_line_its_pack_can_say(out):
    d = out["drive"]
    for w in ("plain", "rally"):
        for pack, q in out["samples"][w]["quotes"].items():
            assert q, (w, pack)
            want = (d["plainCard"] if out["cards"][pack] else d["plain"]) if w == "plain" else d["rally"]
            assert q["call"] == want, (w, pack, q)
            assert q["signOff"] in out["packLines"][pack] and q["token"].startswith("sys:end"), (w, pack, q)
            assert q["text"] == f'{q["call"]}. {q["signOff"]}'
            # the words the recording showed and the voice never said
            assert "Late apex" not in q["text"] and "Easy in" not in q["text"] and "Left four" not in q["text"]
