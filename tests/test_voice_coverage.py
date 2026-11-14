"""One voice for the whole drive: every line the co-driver says has clips in each voice pack (web/voices/<id>), so the
phone's own robotic voice never cuts in. The owner heard "a lot of system voice" (2026-11-14): Plain words corners, road
marks, the quiet lines (limit, briefing, twisty section, descent, sun, brake heat, flow) and the DOTs' traffic events were
all falling to it. Each generator's output is sampled, turned into clips (voice_lines.js compose / quietTokens /
openerTokens, plain_notes.js plainTokens, voice.js codriverTokens), and checked two ways: the clips' own words are the
line's words, and every clip is in every bank."""
import json
import os
import re
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")
sys.path.insert(0, os.path.join(ROOT, "tools"))
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
PACKS = ("marguerite", "kit", "hale")

RUNNER = r"""
const R = process.argv[1];
let metric = false;
globalThis.localStorage = { getItem: () => (metric ? 'metric' : 'imperial'), setItem() {} };
const U = require(R + '/web/units.js');
const units = { metric: () => metric, spokenShort: (m) => { U._reset(); return U.spokenShort(m); } };
const L = require(R + '/web/voice_lines.js');
const P = require(R + '/web/plain_notes.js');
const NT = require(R + '/web/note_timing.js');
const LA = require(R + '/web/limit_ahead.js'), FL = require(R + '/web/flow_live.js'), B = require(R + '/web/briefing.js');
const CA = require(R + '/web/corners_ahead.js'), BH = require(R + '/web/brake_heat.js'), SA = require(R + '/web/sun_ahead.js');
const lines = [];   // [text, tokens, what]
const add = (what, text, tokens) => lines.push([text, tokens, what]);
const said = (text) => L.forText(text) || L.compose(text);
// the quiet lines
// posted limits: up to 85 mph and 130 km/h
for (metric of [false, true]) for (let mps = 4; mps <= 36.5; mps += 0.25) { const t = LA.text(mps, (v) => v * (metric ? 3.6 : 2.2369362921)); if (t) add('limit', t, said(t)); }
for (let n = 1; n <= 260; n++) { if (FL.milestone(n)) add('flow', FL.text(n), said(FL.text(n))); add('flow best', FL.bestText(n), said(FL.bestText(n))); }
const corner = (m, sev = 4) => ({ type: 'corner', dist_m: m, severity: sev });
for (metric of [false, true]) for (const km of [3.2, 8, 20, 64, 150]) for (const nc of [5, 12, 48, 130]) for (const hp of [0, 1, 3]) {
  const dist = [0, km * 1000], events = [...Array.from({ length: nc }, (_, k) => corner(10 + k)), ...Array.from({ length: hp }, (_, k) => corner(5 + k, 'HP'))];
  const t = B.line({ dist, events }, 0, units); if (t) add('briefing', t, said(t)); }
for (const n of [3, 9, 24, 140]) { const t = CA.text({ startM: 1000, endM: 4000, corners: n }); add('twisty', t, said(t)); }
add('descent', BH.descentCall({ grade: 0.08, start_m: 0, end_m: 5000 }), said(BH.descentCall({ grade: 0.08, start_m: 0, end_m: 5000 })));
add('brakes', BH.CALL_TEXT, said(BH.CALL_TEXT));
add('sun', SA.TEXT, said(SA.TEXT));
// the DOTs' traffic events (hazard_reports.js: "<label> ahead"), every label backend/src/traffic.ts gives
for (const l of JSON.parse(process.argv[2])) add('dot', `${l} ahead`, said(`${l} ahead`));
// how far the quiet lasts, and the drive's opener, in each pack
for (const id of ['marguerite', 'kit', 'hale']) {
  // up to ten and a half (past it the cockpit plays the chime alone)
  for (metric of [false, true]) for (let m = 800; m <= (metric ? 10900 : 17500); m += 50) { const s = NT.quietSpan(m, units); if (s) add(`quiet ${id}`, L.quietLine(id, s), L.quietTokens(id, s)); }
  for (const awake of [true, false]) add(`opener ${id}`, L.openerLine(id, { road: 'Dry Ridge Road', awake }).replace(/^Dry Ridge Road\. /, ''), L.openerTokens(id, { awake }));
}
// Plain words: every corner kind, caution and modifier, chained, naming the next, with advice
const kinds = [{ severity: 1 }, { severity: 2, grade: '-' }, { severity: 3 }, { severity: 4, grade: '+' }, { severity: 5 }, { severity: 6 }, { severity: 'HP' }, { shape: 'square', severity: 3 }, { shape: 'acute', severity: 2 }];
const mods = [[], ['long'], ['tightens'], ['opens'], ['off-camber'], ['over crest'], ['banked'], ['short'], ['long', 'tightens']];
const notes = [];
for (const dir of ['L', 'R']) for (const k of kinds) for (const c of [0, 1, 2, 3, 4]) for (const m of mods) notes.push({ type: 'corner', dir, ...k, caution: c, mods: m });
const hazards = [{ type: 'crest', call: 'Crest' }, { type: 'bump', call: 'Bump' }, { type: 'dip', call: 'Dip' }, { type: 'alpr', call: 'Camera' },
  ...Object.keys(P.MARK_KEY).map((call) => ({ type: 'mark', call }))];
const plainSay = (chain, opts) => add('plain', P.plainChain(chain, units, opts), P.plainTokens(chain, units, opts));
for (const n of [...notes, ...hazards]) plainSay([n], {});
for (let i = 0; i < notes.length; i += 7) plainSay([{ ...notes[i], link: 'into' }, notes[(i * 13) % notes.length]], {});
for (const h of hazards) plainSay([{ ...notes[3], link: 'and' }, h], {});
for (metric of [false, true]) for (let m = 10; m <= 270; m += 5) for (const next of [notes[50], notes[400], hazards[0], hazards[6]]) {
  plainSay([{ ...notes[20], link: String(m) }], { next, reachM: 270 });
  plainSay([{ ...notes[20], link: String(m) }], { next, reachM: 270, card: true });
}
plainSay([notes[30]], { advice: 'Brake before it, not in it.', adviceToken: 'aside:hairpin' });
process.stdout.write(JSON.stringify({ lines, text: L.TEXT }));
"""


def traffic_labels():
    src = open(os.path.join(ROOT, "backend", "src", "traffic.ts"), encoding="utf-8").read()
    labels = set(re.findall(r'label = "([A-Z][^"]+)"', src)) | set(re.findall(r'"(Road closed|Lane closed|Roadwork)"\]', src))
    labels |= {f"Closed {d}bound" for d in ("north", "south", "east", "west")}
    return sorted(labels)


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, ROOT, json.dumps(traffic_labels())], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def say(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + say(n % 100))


def words(s):
    s = re.sub(r"\d+", lambda m: " " + say(int(m.group())) + " ", s.lower().replace("-", " "))
    return re.sub(r"[^a-z ]+", " ", s).split()


def bank(pid):
    return json.load(open(os.path.join(ROOT, "web", "voices", pid, "manifest.json"), encoding="utf-8"))["tokens"]


def test_every_line_has_clips(out):
    missing = sorted({f"{what}: {text}" for text, toks, what in out["lines"] if not toks})
    assert missing == [], missing[:20]


def test_the_clips_say_the_line_word_for_word(out):
    import voicebank
    wrong = []
    for text, toks, what in out["lines"]:
        pack = next((p for p in PACKS if p in what.split()), "marguerite")
        vocab = voicebank.codriver_vocabulary(pack)
        heard = [w for t in toks for w in words(vocab[t])]
        if heard != words(text):
            wrong.append((what, text, toks))
    assert wrong == [], wrong[:10]


@pytest.mark.parametrize("pid", PACKS)
def test_every_clip_is_in_the_bank(out, pid):
    m = bank(pid)
    mine = lambda what: not set(what.split()) & set(PACKS) or pid in what.split()
    need = {t for _, toks, what in out["lines"] if toks and mine(what) for t in toks}
    need |= set(out["text"])
    missing = sorted(t for t in need if t not in m)
    assert missing == [], missing[:20]


def test_a_road_mark_in_a_rally_call_plays_its_own_clip():
    js = open(os.path.join(ROOT, "web", "voice.js"), encoding="utf-8").read()
    assert "if (e.type === 'mark')" in js and "P.hazardToken(e)" in js
    cockpit = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    # the plain call carries its clips, and so does every line said by its text
    assert "tokens: opt.advice ? pt({ advice: opt.advice, adviceToken: opt.adviceToken }) : bareTokens" in cockpit
    assert "ApexVoiceLines.forText(text) || ApexVoiceLines.compose(text)" in cockpit
