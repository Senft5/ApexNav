"""The three co-drivers (docs/design/REVIEW.md 4.4, REVIEW5 U-113): each pack has its own words around a call that is the
same in every pack, its own system lines and four sign-offs, all rendered into its bank; Kit's box shows Kit's aside; the
theme cards quote lines the voices really say."""
import json
import os
import re
import shutil
import subprocess
import sys

import pytest
from tests.page_source import cockpit_source

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not installed")
PACK_IDS = ("marguerite", "kit", "hale")
SAFETY = re.compile(r"\b(left|right|careful|caution|slow|\d+|feet|metres|miles?|faster|speed|mph|flat)\b", re.I)


def node(js):
    return json.loads(subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, check=True).stdout)


def packs():
    src = open(os.path.join(ROOT, "web", "voice_lines.js"), encoding="utf-8").read()
    return json.loads(src.split("/* VOICE_PACKS_JSON */", 1)[1].split("/* END_VOICE_PACKS_JSON */", 1)[0])


def test_every_pack_has_its_asides_and_four_sign_offs():
    p = packs()
    assert set(p) == set(PACK_IDS)
    asides = {k for k in p["kit"]["lines"] if k.startswith("aside:")}
    assert len(asides) >= 8
    for pid in PACK_IDS:
        lines = p[pid]["lines"]
        assert {k for k in lines if k.startswith("aside:")} == asides, pid
        assert [k for k in lines if re.fullmatch(r"sys:end\d*", k)] == ["sys:end", "sys:end2", "sys:end3", "sys:end4"], pid
    # the words differ from pack to pack, not just the last line
    for k in asides | {"sys:end", "sys:end2", "sys:end3", "sys:end4", "sys:sample"}:
        assert len({p[pid]["lines"][k] for pid in PACK_IDS}) == 3, k
    assert p["kit"]["lines"]["aside:tightens"] == "Easy in, late out."      # REVIEW.md 4.4
    assert p["hale"]["card"] is True and p["kit"]["card"] is False


def test_the_character_never_carries_a_safety_word():
    # direction, severity, "careful", distances and speed belong to the call, the same in every pack; an aside or a sign-off
    # never adds one of its own (and never praises pace)
    for pid, pack in packs().items():
        for k, text in pack["lines"].items():
            if k.startswith("aside:") or re.fullmatch(r"sys:end\d*", k):
                assert not SAFETY.search(text), (pid, k, text)


def test_the_renderer_holds_every_pack_line():
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    try:
        import voicebank
    except ModuleNotFoundError as e:             # numpy not installed here
        pytest.skip(str(e))
    for pid, pack in packs().items():
        v = voicebank.codriver_vocabulary(pid)
        for k, text in pack["lines"].items():
            assert v[k] == text, (pid, k)


@needs_node
def test_asides_are_rare_and_never_after_a_warning():
    r = node(r"""
    const L = require(process.argv[1] + '/web/voice_lines.js');
    const c = (o) => ({ type: 'corner', dir: 'L', severity: 4, mods: [], caution: 0, ...o });
    const tok = [[c({ mods: ['tightens'] })], [c({ mods: ['long', 'tightens'] })], [c({ severity: 'HP', shape: 'hairpin' })], [c({ shape: 'square' })],
      [c({ mods: ['tightens'], caution: 1 })], [c({ mods: ['tightens'], caution: 2 })], [c({ mods: ['tightens'] }), c({})], [c({})],
      [{ type: 'crest', call: 'Crest' }], [{ type: 'bump', call: 'Bump' }], [c({ mods: ['tightens'], recce: true })]].map(L.asideToken);
    const a = L.createAsides();
    const t = [a.pick('kit', [c({ mods: ['tightens'] })], 0), a.pick('kit', [c({ mods: ['long'] })], 10000), a.pick('kit', [c({ mods: ['long'] })], 46000),
      a.pick('kit', [c({ mods: ['tightens'] })], 100000), a.pick('kit', [c({ mods: ['tightens'] })], 190000)];
    const b = L.createAsides();
    const missing = b.pick('hale', [c({ mods: ['tightens'] })], 0, () => false);
    process.stdout.write(JSON.stringify({ tok, t, missing, stillFree: b.pick('hale', [c({ mods: ['tightens'] })], 1, () => true) }));
    """)
    assert r["tok"] == ["aside:tightens", "aside:tightens", "aside:hairpin", "aside:square", "aside:tightens", None, None, None,
                        "aside:crest", None, None]
    assert [x and x["text"] for x in r["t"]] == ["Easy in, late out.", None, "Long one. Settle in.", None, "Easy in, late out."]
    # a bank without the clip (rendered before the asides) says none, and that doesn't use up the turn
    assert r["missing"] is None and r["stillFree"]["text"] == "Late apex."


@needs_node
def test_sign_offs_are_picked_per_drive_from_the_bank():
    r = node(r"""
    const E = require(process.argv[1] + '/web/end_line.js');
    const ids = Array.from({ length: 40 }, (_, i) => 'drive-' + i);
    process.stdout.write(JSON.stringify({
      seen: [...new Set(ids.map((id) => E.pickSignOff('kit', id)))].sort(),
      same: E.pickSignOff('hale', 'd1') === E.pickSignOff('hale', 'd1'),
      old: E.pickSignOff('hale', 'd1', (k) => k === 'sys:end'),
      line: E.endLine('hale', 555, false, 'sys:end3'), kit: E.endLine('kit', 82, true, 'sys:end2').text,
      bad: E.endLine('kit', 82, false, 'aside:long').tokens }));
    """)
    assert r["seen"] == ["sys:end", "sys:end2", "sys:end3", "sys:end4"] and r["same"]
    assert r["old"] == "sys:end"                                     # a bank from before keeps its one sign-off
    assert r["line"] == {"tokens": ["sys:end3", "end:score", "n:h5", "n:55"], "text": "End of card. Score, five hundred fifty-five."}
    assert r["kit"] == "Eighty-two. Best yet on this road. Tape's out."
    assert r["bad"] == ["n:82", "sys:end"]


@needs_node
def test_the_card_quotes_a_line_the_voice_says():
    # the sample is the call (rally or plain words, as the pack delivers it) and the aside the pack says after it
    r = node(r"""
    const R = process.argv[1], L = require(R + '/web/voice_lines.js'), P = require(R + '/web/plain_notes.js');
    const e = { type: 'corner', dir: 'L', severity: 4, mods: ['tightens'], caution: 0 };
    const out = {};
    for (const id of ['marguerite', 'kit', 'hale']) {
      const card = L.PACKS[id].card, aside = L.packLine(id, L.asideToken([e]));
      out[id] = { plain: L.sample(id, 'plain'), rally: L.sample(id, 'rally'), call: P.plainChain([e], null, { card }), aside, card };
    }
    process.stdout.write(JSON.stringify(out));
    """)
    for pid, x in r.items():
        assert x["plain"]["token"] == "sys:sample_plain" and x["rally"]["token"] == "sys:sample"
        assert x["plain"]["text"] == f"{x['call']}. {x['aside']}", pid
        rally = "Left four. Tightens." if x["card"] else "Left four, tightens."
        assert x["rally"]["text"] == f"{rally} {x['aside']}", pid


def test_the_page_says_the_pack_lines_and_fills_kits_box():
    html = cockpit_source()
    # the call carries its aside; Kit's box is the aside, never the call
    assert "const aside = packAside(call.voiced, noteM(e), vMps, apexMps, call.text, reactS);" in html and "kitFor: call.keys, aside," in html
    assert "if (text && 'aside' in opts) { state.kitLine = opts.aside ? opts.aside.text" in html
    assert "state.kitLine = String(text)" not in html
    # the aside follows its call only when nothing else waits, and never after it would be late
    assert "if (follow && !speech.queue.size && state.toggles.voice)" in html and "dueByM: follow.dueByM" in html
    # the pack's own system lines and sign-offs; the card's quote and Hear from the pack
    assert "packSays('sys:cruise', 'Quiet from here. Bumps and cameras only.')" in html
    assert "ApexEndLine.pickSignOff(pack, c.id, has)" in html
    # HE-3 (panel round 2): the card's quote is the call grammar's sample and a sign-off of the pack's (test_vocabulary.py)
    assert "ApexVocabulary.sampleQuote(t.voice.id, state.noteWords, vocabDeps())" in html and "t.voice.sample" not in html
    themes = open(os.path.join(ROOT, "web", "themes.js"), encoding="utf-8").read()
    assert "sample:" not in themes
    inst = open(os.path.join(ROOT, "web", "instruments.js"), encoding="utf-8").read()
    assert "says.classList.toggle('quiet', !d.kitLine)" in inst and "says, '--')" not in inst
    queue = open(os.path.join(ROOT, "web", "speech_queue.js"), encoding="utf-8").read()
    assert "aside: line.aside || null" in queue


def test_every_bank_holds_the_new_clips():
    # rendered with tools/voicebank.py --all --rebuild-checked --only <the keys>: each clip says its pack's words
    p = packs()
    for pid in PACK_IDS:
        m = json.load(open(os.path.join(ROOT, "web", "voices", pid, "manifest.json"), encoding="utf-8"))["tokens"]
        for k, text in p[pid]["lines"].items():
            assert k in m and m[k]["text"] == text, (pid, k)
            assert os.path.exists(os.path.join(ROOT, "web", "voices", pid, m[k]["file"])), (pid, k)
