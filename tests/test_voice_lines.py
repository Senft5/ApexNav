"""web/voice_lines.js: the lines every voice pack says besides the pace notes, so a drive is said in one voice. Every
distance an early direction can say has a lead-in clip, every maneuver the router sends has one, the fixed lines the page
says by text are in the table word for word, and tools/voicebank.py renders the same table."""
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


def node(js):
    out = subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_every_early_call_distance_has_a_lead_in():
    r = node(r"""
    const R = process.argv[1]; global.window = undefined;
    const L = require(R + '/web/voice_lines.js'); globalThis.ApexVoiceLines = L;
    const D = require(R + '/web/directions.js');
    const missing = [];
    for (const metric of [false, true]) {
      globalThis.ApexUnits = { metric: () => metric };
      // early calls: from max(150 m, 10 s) to max(400 m, 30 s) out, at up to 40 m/s (90 mph)
      for (let m = 150; m <= 1200; m += 5) { const w = D.distWords(m); if (!L.distToken(w)) missing.push(w); }
    }
    process.stdout.write(JSON.stringify([...new Set(missing)]));
    """)
    assert r == [], r


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_every_spoken_maneuver_and_a_whole_route_have_tokens():
    r = node(r"""
    const R = process.argv[1];
    const L = require(R + '/web/voice_lines.js'); globalThis.ApexVoiceLines = L;
    const D = require(R + '/web/directions.js');
    const types = Object.keys(D.VERB).map(Number);
    const noTokens = types.filter((t) => !(L.maneuver({ type: t, exits: 2 }) || []).every((k) => L.TEXT[k]));
    const steps = [{ m: 800, type: 15, street: 'Deals Gap Road' }, { m: 880, type: 10, street: 'Hollow Creek Road' }, { m: 3000, type: 26, exits: 2, street: 'A' }, { m: 6000, type: 4 }];
    const lines = [], said = new Set();
    for (let at = 0; at <= 6000; at += 10) for (const l of D.due(steps, at, 25, said, 'r')) { said.add(l.key); lines.push(l); }
    process.stdout.write(JSON.stringify({ noTokens, lines: lines.map((l) => [l.text, l.tokens]) }));
    """)
    assert r["noTokens"] == [], r
    by = dict((t, k) for t, k in r["lines"])
    assert by["In half a mile, turn left onto Deals Gap Road"] == ["navd:0.5mi", "nav:turn_left"]
    assert by["Turn left onto Deals Gap Road, then turn right onto Hollow Creek Road"] == ["nav:turn_left", "nav:then", "nav:turn_right"]
    assert by["At the roundabout, take the 2nd exit onto A"] == ["nav:rb2"]
    assert by["Arriving at your destination"] == ["nav:arrive"]
    assert all(k for _, k in r["lines"]), r["lines"]


def test_the_fixed_lines_the_page_says_are_in_the_table_word_for_word():
    import voicebank
    lines = {v.rstrip(".") for k, v in voicebank.voice_lines().items() if k.startswith("line:")}
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    for said in ("Back on route", "Rerouting", "Staying on this route", "Track mode. Tap start finish when you cross the line"):
        assert f"say('{said}" in html and said in lines, said
    memory = open(os.path.join(ROOT, "web", "road_memory.js"), encoding="utf-8").read()
    for text in re.findall(r"(?:brake_after_apex|coast|early_apex): '([^']+)'", memory) + re.findall(r"text: '(Bump ahead)'", memory):
        assert text.rstrip(".") in lines, text
    rest = open(os.path.join(ROOT, "web", "break_worker.js"), encoding="utf-8").read()
    for text in re.findall(r"text: '([^']+\?)'", rest):
        assert text.rstrip(".") in lines, text


def test_the_renderer_reads_the_same_table():
    import voicebank
    vocab = voicebank.codriver_vocabulary("kit")
    assert vocab["nav:turn_left"] == "Turn left." and vocab["navd:0.5mi"] == "In half a mile," and vocab["line:rerouting"] == "Rerouting."
    assert vocab["sys:end"] == "That's a wrap."          # a pack's own lines still win
