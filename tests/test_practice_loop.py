"""Practice Loop (web/practice_loop.js, PracticeLoop.swift, ApexKit PracticeLoop.swift; the owner 2026-11-17): the owner's
ear-training player. Only the owner sees it, only in the app, its module loads lazily, and the page is a remote for the
native player. The sound itself is tested in ApexKit (PracticeLoopTests: 30 minutes with no gap or drift)."""
import json
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")


def read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


def node(js):
    r = subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


# a DOM just big enough for mount(): elements with children, attributes, dataset, classList and click listeners
FAKE_DOM = r"""
class N {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.on = {};
    this.textContent = ''; this.value = ''; this.disabled = false; this.className = ''; this.type = ''; this.min = ''; this.max = ''; this.step = '';
    const self = this; this.classList = { set: new Set(), toggle(c, f) { f ? this.set.add(c) : this.set.delete(c); }, contains(c) { return this.set.has(c); } }; }
  append(...k) { for (const c of k) if (c != null) this.children.push(typeof c === 'string' ? { text: c } : c); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { this.on[t] = f; }
  get childElementCount() { return this.children.length; }
  all() { const out = [this]; for (const c of this.children) if (c instanceof N) out.push(...c.all()); return out; }
}
const document = { createElement: (t) => new N(t), activeElement: null };
"""


def test_only_the_owner_in_the_app_gets_it():
    if NODE is None:
        pytest.skip("node not installed")
    out = node("""const P = require(process.argv[1] + '/web/practice_loop.js');
const owner = { signed_in: true, member: true, moderator: true };
process.stdout.write(JSON.stringify([P.allowed(owner, true), P.allowed(owner, false), P.allowed({ ...owner, moderator: undefined }, true),
  P.allowed({ signed_in: true, member: true, developer: true }, true), P.allowed({ ...owner, member: false }, true), P.allowed(null, true)]));""")
    assert out == [True, False, False, False, False, False]
    cockpit = read("web", "cockpit.js")
    # the row's section is filled only for the owner in the app; anyone else's stays empty, so garage_settings hides the row
    assert "me.moderator === true" in cockpit and "function paintPracticeRow(me)" in cockpit
    assert "paintPracticeRow(me);" in cockpit
    html = read("web", "index.html")
    assert re.search(r'<section data-panel="garage" data-setting="practice" data-title="Practice Loop" data-empty-hides>\s*<div id="garagePracticeBody"[^>]*data-fill></div>\s*</section>', html)
    # lazy: never on a launch
    assert "practice: ['practice_viz.js', 'practice_loop.js']" in read("web", "lazy.js")
    assert 'src="practice_loop.js"' not in html and 'src="practice_viz.js"' not in html


def test_tempos_match_the_native_pool():
    if NODE is None:
        pytest.skip("node not installed")
    js = node("process.stdout.write(JSON.stringify(require(process.argv[1] + '/web/practice_loop.js').BPMS))")
    swift = read("ApexKit", "Sources", "ApexKit", "PracticeLoop.swift")
    pool = re.search(r"bpmPool = \[([^\]]+)\]", swift).group(1)
    assert js == [int(x) for x in re.findall(r"\d+", pool)]


def test_the_sheet_is_a_remote_for_the_shell():
    if NODE is None:
        pytest.skip("node not installed")
    out = node(FAKE_DOM + """
const P = require(process.argv[1] + '/web/practice_loop.js');
const sent = []; const body = new N('div');
P.mount(body, { post: (m) => sent.push(m), document });
const btns = body.all().filter((n) => n.tagName === 'BUTTON');
const by = (t) => btns.find((b) => b.textContent === t);
const first = sent.map((m) => m.action);
by('Play').on.click();
P.onNative({ type: 'practice', active: true, playing: true, title: 'D Dorian · 92', settings: { focus: 'modes', drone: false, sleepMin: 30 } });
const now = body.all().find((n) => n.className === 'pl-now').textContent;
const playLabel = btns[0].textContent;
by('Arps').on.click();
by('Next').on.click();
const pressed = btns.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
P.onNative({ type: 'practice', error: "Couldn't start the audio: x" });
const err = body.all().find((n) => n.className === 'pl-now').textContent;
process.stdout.write(JSON.stringify({ first, start: sent[1], now, playLabel, focus: sent[2], next: sent[3], pressed, err }));
""")
    assert out["first"] == ["state"], "it asks the shell for its state, and plays nothing, on opening"
    assert out["start"]["cmd"] == "practice" and out["start"]["action"] == "start"
    assert out["start"]["settings"]["repsMin"] == 5 and out["start"]["settings"]["repsMax"] == 10 and out["start"]["settings"]["drone"] is True
    assert out["now"] == "D Dorian · 92" and out["playLabel"] == "Pause"
    assert out["focus"] == {"cmd": "practice", "action": "settings", "settings": {"focus": "arpeggios"}}
    assert out["next"] == {"cmd": "practice", "action": "next"}
    assert "Arps" in out["pressed"] and "30 m" in out["pressed"]
    assert out["err"].startswith("Couldn't start the audio")


def test_native_player_wiring():
    shell = read("ApexNavApp.swift")
    assert 'if cmd == "practice", let dict = body as? [String: Any]' in shell
    # nothing is made until the page first asks
    assert "private var practice: ApexPracticeLoop?" in shell and "if practice == nil { practice = ApexPracticeLoop(shell: self) }" in shell
    # a co-driver line hands the session back to the player; convoy voice (the microphone) stops it
    assert "if practiceOn || practiceListening { holdForPractice(); return }" in shell
    assert "if on { practice?.stop() }" in shell
    p = read("PracticeLoop.swift")
    for needle in ["AVAudioSourceNode", "setCategory(.playback, mode: .default, options: [])", "writer.write(",
                   "AVAudioSession.interruptionNotification", ".shouldResume", ".oldDeviceUnavailable",
                   "mediaServicesWereResetNotification", "AVAudioEngineConfigurationChange",
                   "MPNowPlayingInfoCenter", "nextTrackCommand", "togglePlayPauseCommand"]:
        assert needle in p, needle
    yml = read("project.yml")
    assert "- path: PracticeLoop.swift" in yml
    assert re.search(r"UIBackgroundModes:\s*\n\s*- location\s*\n\s*- audio", yml)


def test_solfege_spelling_and_the_flats_and_sharps_that_exist():
    if NODE is None:
        pytest.skip("node not installed")
    out = node("""const V = require(process.argv[1] + '/web/practice_viz.js');
const name = (s, ints) => V.syllable(V.spell(s, ints));
const sc = (ints) => [...ints, 12].map((x) => name(x, ints)).join(' ');
const cols = V.COLS.map((c) => [c[0], c[2] && c[2][0], c[3] && c[3][0]]);
process.stdout.write(JSON.stringify({ cols,
  ionian: sc([0, 2, 4, 5, 7, 9, 11]), dorian: sc([0, 2, 3, 5, 7, 9, 10]), phrygian: sc([0, 1, 3, 5, 7, 8, 10]),
  lydian: sc([0, 2, 4, 6, 7, 9, 11]), locrian: sc([0, 1, 3, 5, 6, 8, 10]), whole: sc([0, 2, 4, 6, 8, 10]),
  blues: sc([0, 3, 5, 6, 7, 10]), aug: sc([0, 4, 8]), m7b5: sc([0, 3, 6, 10]) }));""")
    # "if applicable": no flat do, no sharp mi, no flat fa, no sharp ti, nothing under the top do
    assert out["cols"] == [["do", None, "di"], ["re", "ra", "ri"], ["mi", "me", None], ["fa", None, "fi"],
                           ["sol", "se", "si"], ["la", "le", "li"], ["ti", "te", None], ["do", None, None]]
    assert out["ionian"] == "do re mi fa sol la ti do"
    assert out["dorian"] == "do re me fa sol la te do"
    assert out["phrygian"] == "do ra me fa sol le te do"
    assert out["lydian"] == "do re mi fi sol la ti do"
    assert out["locrian"] == "do ra me fa se le te do"
    assert out["whole"] == "do re mi fi si te do"
    assert out["blues"] == "do me fa se sol te do"
    assert out["aug"] == "do mi si do" and out["m7b5"] == "do me se te do"


def test_the_ball_follows_the_grid_in_every_note_value():
    if NODE is None:
        pytest.skip("node not installed")
    out = node("""const V = require(process.argv[1] + '/web/practice_viz.js');
const notes = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0];
const res = {};
for (const step of [16, 8, 4, 2, 1]) {
  const rep = Math.ceil(notes.length * step / 16) * 16;
  const c = { bpm: 60, step, notes, repSixteenths: rep };
  const sec = (s16) => s16 * 15 / 60;                       // 16ths to seconds at 60 BPM
  res[step] = {
    countIn: V.at(c, sec(4)).inCountIn && V.at(c, sec(4)).idx === -1,
    first: V.at(c, sec(16)).idx, second: V.at(c, sec(16 + step)).idx,
    midFirst: V.at(c, sec(16 + step / 2)).idx,
    last: V.at(c, sec(16 + 14 * step)).idx,
    restNext: V.at(c, sec(16 + 14 * step + step / 2)).next === 16 + rep,
    rep2: V.at(c, sec(16 + rep)).idx,
    landed: V.hop(c, V.at(c, sec(16 + step))).t, before: V.hop(c, V.at(c, sec(16 + step - 0.01))).t,
  };
}
const w = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((b) => V.wallX(b));
process.stdout.write(JSON.stringify({ res, w }));""")
    for step, r in out["res"].items():
        assert r["countIn"], step
        assert (r["first"], r["second"], r["midFirst"], r["last"], r["rep2"]) == (0, 1, 0, 14, 0), step
        assert r["restNext"], step
        assert r["landed"] == 0, f"{step}: on the note at its onset"
        assert r["before"] > 0.9, f"{step}: in the air just before"
    assert out["w"] == [0, 0.5, 1, 0.5, 0, 0.5, 1], "a wall on every beat"


def test_pictures_only_while_on_screen():
    viz = read("web", "practice_viz.js")
    assert "IntersectionObserver" in viz and "doc.hidden" in viz and "requestAnimationFrame" in viz
    p = read("PracticeLoop.swift")
    assert "guard watching, active, let r = renderer, UIApplication.shared.applicationState == .active" in p
    assert "s.outputLatency + s.ioBufferDuration" in p


def test_voice_range_test_on_the_sheet():
    """Nate 2026-11-17: sing your lowest and highest note; for that session only notes inside that range are played."""
    if NODE is None:
        pytest.skip("node not installed")
    out = node(FAKE_DOM + """
const P = require(process.argv[1] + '/web/practice_loop.js');
const sent = []; const body = new N('div');
P.mount(body, { post: (m) => sent.push(m), document });
const btns = body.all().filter((n) => n.tagName === 'BUTTON');
const text = () => body.all().find((n) => n.className === 'pl-range').textContent;
const go = btns.find((b) => b.textContent === 'Test my range');
const idle = { text: text(), clearHidden: btns.find((b) => b.textContent === 'Clear').hidden };
go.on.click();
const start = sent[sent.length - 1];
P.onNative({ type: 'practiceRange', step: 'low', now: 'F2' });
const listening = { text: text(), label: go.textContent, disabled: go.disabled };
P.onNative({ type: 'practiceRange', step: 'low', now: 'F2', best: 'E2' });
const heard = { text: text(), label: go.textContent, disabled: go.disabled };
go.on.click();
const done = sent[sent.length - 1];
P.onNative({ type: 'practice', active: true, playing: true, title: 'G Dorian · 92 · half', range: { step: null, lo: 40, hi: 67, label: 'E2 to G4' } });
const set = { text: text(), label: go.textContent };
btns.find((b) => b.textContent === 'Clear').on.click();
const clear = sent[sent.length - 1];
process.stdout.write(JSON.stringify({ idle, start, listening, heard, done, set, clear }));
""")
    assert out["idle"]["text"].startswith("Any octave") and out["idle"]["clearHidden"] is True
    assert out["start"] == {"cmd": "practice", "action": "range", "step": "start"}
    assert out["listening"]["text"].startswith("Sing your lowest note") and "F2" in out["listening"]["text"]
    assert out["listening"]["disabled"] is True, "nothing held yet: nothing to keep"
    assert "lowest held E2" in out["heard"]["text"] and out["heard"]["label"] == "Got it" and out["heard"]["disabled"] is False
    assert out["done"] == {"cmd": "practice", "action": "range", "step": "done"}
    assert out["set"]["text"] == "E2 to G4, for this session" and out["set"]["label"] == "Test again"
    assert out["clear"] == {"cmd": "practice", "action": "range", "step": "clear"}


def test_voice_range_native_wiring():
    p = read("PracticeLoop.swift")
    # the microphone is asked for only when the test starts, never kept, and the player picks inside the range
    assert "AVAudioApplication.requestRecordPermission" in p and p.index("Self.askForMicrophone") > p.index("private func listen()")
    assert "PracticePicker.next(settings, after: lastPick, range: range, using: &rng)" in p
    assert "e.inputNode.removeTap(onBus: 0)" in p and "shell?.setPracticeListening(false)" in p
    assert "UserDefaults" not in p.split("// MARK: the voice range test")[1], "the range is for the session only"
    shell = read("ApexNavApp.swift")
    assert "ApexAudioSession.set(.playAndRecord, mode: .measurement" in shell
    assert "if practiceOn || practiceListening { holdForPractice(); return }" in shell
    kit = read("ApexKit", "Sources", "ApexKit", "PracticeLoop.swift")
    assert "Self.hz(midi: b.pick.base + notes[noteIdx])" in kit and "Self.hz(midi: b.pick.droneMidi)" in kit
    assert "hears your singing when you test your vocal range" in read("project.yml")
