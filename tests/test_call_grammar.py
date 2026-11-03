"""Panel round 1 (docs/design/panel/round-1/margo.md, priya.md): M-1 a call grammar (the warning first, one short word per
thing), M-2 asides that ride with the call or are not said and never land in the braking zone, M-3 / P-2 one notation
(the strip's next cells, the car's plates, the island and the Log say what the head says)."""
import json
import os
import re
import shutil
import subprocess

import pytest
from tests.page_source import cockpit_source

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1];
globalThis.localStorage = { getItem: () => 'imperial', setItem() {} };
const P = require(R + '/web/plain_notes.js'), I = require(R + '/web/instruments.js'), U = require(R + '/web/units.js');
const L = require(R + '/web/voice_lines.js'), T = require(R + '/web/note_timing.js');
U._reset();
const c = (o) => ({ type: 'corner', dir: 'L', severity: 3, mods: [], caution: 0, ...o });
const sq = c({ shape: 'square', severity: 2, code: 'LSQ', caution: 1 });
// every corner the detector can rate, with every caution and modifier
const all = [];
for (const s of [1, 2, 3, 4, 5, 6, 'HP']) for (const shape of [null, 'square', 'acute']) for (const k of [0, 1, 2, 3, 4])
  all.push(P.plainCall(c({ severity: s, shape, caution: k, mods: k % 2 ? ['long'] : ['tightens'] })));
const mph = (v) => v / 2.2369362921, ft = (v) => v * 0.3048;
console.log(JSON.stringify({
  careful: P.plainCall(c({ dir: 'R', severity: 2, caution: 1 })), hp: P.plainCall(c({ severity: 'HP', mods: ['long'], caution: 1 })),
  square: P.plainCall(c({ shape: 'square' })), acute: P.plainCall(c({ shape: 'acute', dir: 'R', mods: ['long'] })),
  chain: P.plainChain([c({ severity: 4, link: '60' })], U, { next: sq }),
  mid: P.plainChain([c({ severity: 4, link: 'into' }), { ...sq, link: null }], U),
  card: P.plainChain([c({ dir: 'R', severity: 2, caution: 1, mods: ['long'] })], U, { card: true }),
  all,
  plain: [c({ code: 'L3' }), c({ dir: 'R', severity: 1, code: 'R1' }), sq, c({ shape: 'acute', code: 'LAC' }), c({ severity: 'HP', code: 'RHP', dir: 'R' }),
    c({ severity: 5 }), c({ severity: 6 }), c({ severity: 4 })].map((n) => P.noteCode(n, 'plain')),
  rally: [c({ code: 'L3' }), c({ severity: 4, grade: '-' }), sq, c({ shape: 'acute' }), c({ severity: 'HP' })].map((n) => P.noteCode(n, 'rally')),
  fromCode: ['LSQ', 'RAC', 'L5-', 'RHP', 'X1'].map((code) => P.noteCode({ type: 'corner', code }, 'plain')),
  hazard: P.noteCode({ type: 'crest', code: 'CREST' }, 'plain'),
  strip: { plain: I.stripCode({ type: 'corner', code: 'LAC', dir: 'L', severity: 1 }, 'plain'), rally: I.stripCode({ type: 'corner', code: 'LAC', dir: 'L', severity: 1 }, 'rally'),
           rsq: I.stripCode({ type: 'corner', code: 'RSQ', dir: 'R', severity: 2 }), crest: I.stripCode({ type: 'crest', code: 'CREST', call: 'Crest' }, 'plain'),
           recce: I.stripCode({ type: 'corner', code: 'R3', dir: 'R', severity: 3, recce: true }, 'plain'),
           turn: I.stripCode({ type: 'turn', dir: 'R', code: 'Keep right' }, 'plain') },
  lockup: [I.lockup('Careful, hairpin left, long', ['long']), I.lockup('Slow down, medium left, tightens, slopes away', ['tightens', 'off-camber']),
           I.lockup('Square left', []), I.lockup('Left 4 plus long tightens, care', ['long', 'tightens'])],
  // M-2
  kinds: Object.fromEntries(Object.keys(L.PACKS).map((id) => [id, Object.keys(L.PACKS[id].lines).filter((k) => k.startsWith('aside:')).map((k) => [k, L.asideKind(id, k)])])),
  linked: [L.asideToken([c({ severity: 'HP', link: '150' })]), L.asideToken([c({ severity: 'HP', link: null })]), L.asideToken([c({ severity: 'HP', link: 'into' })])],
  // Margo's hairpin: "Brake well before this one." at 100 ft and 22 mph, the car down from 33
  late: T.asideWindow({ dM: ft(100), atM: 1000, vMps: mph(22), apexMps: mph(15), callText: 'Hairpin right, long', text: 'Brake well before this one.', kind: 'advice' }),
  // round 2 MA-3: the same advice at 34 mph, planned with the call: the call starts at the aside's lead and both end in time
  early: (() => { const a = { atM: 1000, vMps: mph(34), apexMps: mph(15), callText: 'Hairpin right, long', text: 'Brake well before this one.', kind: 'advice' };
    const w = T.asideWindow({ dM: 0, ...a }); return { lead: w.leadM, own: T.leadM({ vMps: a.vMps, apexMps: a.apexMps, text: a.callText }),
      atLead: T.asideWindow({ dM: w.leadM, ...a }).fits, secondLate: T.asideWindow({ dM: w.leadM - a.vMps * 1.01, ...a }).fits,
      margin: T.asideMarginM(a), brake: (a.vMps ** 2 - a.apexMps ** 2) / (2 * T.DECEL_MPS2), v: a.vMps }; })(),
  colour: T.asideWindow({ dM: 300, atM: 1000, vMps: mph(34), apexMps: mph(15), callText: 'Open left, long', text: 'It goes on a while.', kind: 'colour' }),
  floor: T.asideMarginM({ vMps: 20, apexMps: 20 }),
  said: T.withAdvice('Careful, hairpin left, long', 'Brake before it, not in it.'),
  fits: (() => { const a = L.createAsides(); const no = a.pick('marguerite', [c({ severity: 'HP' })], 0, () => true, () => false);
    const yes = a.pick('marguerite', [c({ severity: 'HP' })], 1, () => true, (x) => x.kind === 'advice'); return { no, yes }; })(),
}));
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_the_warning_comes_first_and_one_word_per_thing(out):
    """M-1 Done: "Careful, tight right", "Hairpin left, long", "Square left"."""
    assert out["careful"] == "Careful, tight right"
    assert out["hp"] == "Careful, hairpin left, long"
    assert out["square"] == "Square left" and out["acute"] == "Hairpin right, long"
    assert out["card"] == "Careful. Tight right. Long"


def test_in_a_chain_the_caution_sits_in_front_of_its_corner(out):
    assert out["chain"] == "Open left, then careful, square left in 200 feet"     # Margo's example, word for word
    assert out["mid"] == "Open left, then careful, square left"


def test_no_simile_no_near_sounds_and_short(out):
    scale = {"hairpin", "square", "tight", "medium", "open", "easy", "slight"}
    for call in out["all"]:
        head = call.split(", ")
        rest = ", ".join(head[1:] if head[0].lower() in ("careful", "slow down", "slow right down", "very slow") else head)
        assert not re.search(r"\b(very|sharp|like|almost|itself|up)\b", rest.lower()), call   # the safety words stay as they were
        # the caution, if any, is first; the corner's word follows it
        words = head[1] if head[0].lower() in ("careful", "slow down", "slow right down", "very slow") else head[0]
        assert words.split()[0].lower() in scale and words.split()[1] in ("left", "right"), call
        assert len(call.replace(",", "").split()) <= 6, call                          # no call over six words before its link


def test_one_notation_plain_and_rally(out):
    """M-3 / P-2: no LAC, LSQ, RSQ anywhere; plain words with plain words on."""
    assert out["plain"] == ["MEDIUM L", "TIGHT R", "SQUARE L", "HAIRPIN L", "HAIRPIN R", "EASY L", "SLIGHT L", "OPEN L"]
    assert out["rally"] == ["L3", "L4-", "SQ L", "LHP", "LHP"]
    assert out["fromCode"] == ["SQUARE L", "HAIRPIN R", "EASY L", "HAIRPIN R", None] and out["hazard"] is None
    assert all(len(x) <= 9 for x in out["plain"])
    s = out["strip"]
    assert s["plain"] == "HAIRPIN L" and s["rally"] == "LHP" and s["rsq"] == "SQ R" and s["crest"] == "CREST"
    assert s["recce"] == "R3" and s["turn"] == "KEEP R"


def test_the_strip_head_is_the_corner_and_the_caution_leads_the_row(out):
    lk = out["lockup"]
    assert lk[0] == {"head": "Hairpin left", "tail": [{"text": "careful", "warn": True}, {"text": "long", "warn": False}]}
    assert lk[1]["head"] == "Medium left" and [t["text"] for t in lk[1]["tail"]] == ["slow down", "tightens", "slopes away"]
    assert lk[1]["tail"][0]["warn"]
    assert lk[2] == {"head": "Square left", "tail": []}
    assert lk[3]["head"] == "Left 4 plus" and lk[3]["tail"][-1] == {"text": "care", "warn": True}   # rally untouched


def test_the_page_uses_the_drivers_words_everywhere():
    html = cockpit_source()
    assert "showN.words = state.noteWords;" in html                       # the live strip's next cells
    assert "page.words = state.noteWords;" in html and "obNote(OB_NOTES[" in html   # the welcome (P-2)
    assert "state.noteWords === 'plain' && window.ApexPlainNotes ? { ...n, call: ApexPlainNotes.plainCall(n) } : n" in html
    assert "ApexVocabulary.wordsExample(state.noteWords" in html       # the Garage's example, generated (SO-1, test_vocabulary.py)


def test_asides_split_into_advice_and_colour(out):
    k = {pid: dict(rows) for pid, rows in out["kinds"].items()}
    assert k["marguerite"]["aside:acute"] == "advice" and k["marguerite"]["aside:long"] == "colour"
    assert k["kit"]["aside:acute"] == "colour" and k["kit"]["aside:tightens"] == "advice"     # "Proper tight one" is colour
    assert k["hale"]["aside:hairpin"] == "advice" and k["hale"]["aside:off-camber"] == "colour"


def test_no_aside_after_a_call_that_names_the_next_corner(out):
    assert out["linked"] == [None, "aside:hairpin", "aside:hairpin"]


def test_no_aside_in_the_braking_zone(out):
    """M-2: "Brake well before this one." came at 100 ft and 22 mph; it now can't start there. Round 2 MA-3: planned with the
    call, it fits at its own lead (earlier than the call's), and ends before the braking with a think and a reaction spare."""
    assert out["late"]["fits"] is False, out["late"]
    e = out["early"]
    assert e["atLead"] is True and e["lead"] > e["own"], e                 # the call starts earlier to carry it
    assert e["secondLate"] is False, e                                     # over a second's driving late: dropped
    assert e["margin"] >= e["brake"] + e["v"] * (1.5 + 1.2) - 1e-6        # ends before the braking point, a beat to spare
    assert out["colour"]["fits"] is True and out["colour"]["dueByM"] < 1000
    assert out["floor"] == pytest.approx(4 * 20)                           # never under 4 s from the corner
    assert out["said"] == "Careful, hairpin left, long. Brake before it, not in it."   # advice is the call's last sentence


def test_an_aside_that_wont_fit_is_dropped_not_counted(out):
    assert out["fits"]["no"] is None
    assert out["fits"]["yes"]["token"] == "aside:hairpin" and out["fits"]["yes"]["kind"] == "advice"


def test_the_page_times_the_aside_from_the_call():
    html = cockpit_source()
    # round 2 MA-3: planned with the call, which waits for the aside's lead only when one fits
    assert "ApexNoteTiming.asideWindow({ dM, atM, vMps, apexMps, callText: call.text, text, kind, reactionS })" in html
    assert "asides.pick(state.voiceId, call.voiced, performance.now(), (t) => !!bank.tokens[t], fits)" in html
    assert "if (!startCall && !aside && d > ApexNoteTiming.leadM(" in html
    assert "asideDueByM" not in html and "ApexNoteTiming.lastCallM({ vMps, text: a.text })" not in html  # the old rules
    # advice is in the call (its clip in the same breath); colour alone follows it
    assert "[...own, item.aside.token]" in html
    assert "speech.followUp = item.aside && item.aside.kind !== 'advice' ? item.aside : null;" in html


def test_a_wider_plain_code_never_breaks_the_heads_words():
    """"MEDIUM R" is wider than "R3": on a 320 pt phone the head broke "HAIRPIN" mid-word. The code steps down, then the next
    cell gives way (checked in a browser by e2e/smoke.js, the welcome loop's heads)."""
    js = open(os.path.join(ROOT, "web", "instruments.js"), encoding="utf-8").read()
    render = js[js.index("  function renderNotes("):js.index("  // Dial cluster")]
    assert "fitHead(el);" in render
    fit = js[js.index("  function fitHead("):]
    assert "c.style.fontSize = '12px'" in fit and "b.style.display = 'none'" in fit
    # the car's plates are drawn whole on one line, whatever their length (web/carmap.html, CarPlay/ApexCarMap.swift)
    car = open(os.path.join(ROOT, "web", "carmap.html"), encoding="utf-8").read()
    assert "white-space: nowrap" in car[car.index(".car-plate {"):car.index(".car-plate {") + 200]
