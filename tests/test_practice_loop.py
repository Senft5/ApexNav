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
    assert "practice: ['practice_loop.js']" in read("web", "lazy.js")
    assert 'src="practice_loop.js"' not in html


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
    assert "if practiceOn { holdForPractice(); return }" in shell
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
