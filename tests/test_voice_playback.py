"""web/voice.js playback: a call waits for the audio context to run before anything is scheduled (iOS leaves it
'interrupted' each time the app's audio session closes), ends when its last clip really ends, and hands the line to the
device voice when the context won't run, instead of playing late, piled up or cut off."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
RUNNER = r"""
global.window = {};
let mode = process.argv[2], log = [];
class Ctx {
  constructor() { this.state = mode === 'running' ? 'running' : 'interrupted'; this.currentTime = 0; this.destination = {}; }
  resume() { if (mode !== 'stuck') { this.state = 'running'; log.push('resumed'); } return new Promise((r) => setTimeout(r, 5)); }
  decodeAudioData() { return Promise.resolve({ duration: 0.2 }); }
  createBufferSource() {
    const ctx = this, src = { connect() {}, start(t) { log.push('start ' + t.toFixed(2) + (ctx.state === 'running' ? '' : ' (stopped clock)'));
      if (mode !== 'noend') setTimeout(() => { log.push('ended'); src.onended && src.onended(); }, 30); } };
    return src;
  }
}
window.AudioContext = Ctx;
require(process.argv[1] + '/web/voice.js');
const V = window.ApexVoice;
const bank = { id: 't', style: 'codriver', tokens: { 'head:L4': { file: 'a.m4a' }, 'dist:150': { file: 'b.m4a' } } };
global.fetch = async (u) => ({ ok: true, json: async () => bank, arrayBuffer: async () => new ArrayBuffer(4) });
(async () => {
  await V.load('t');
  const t0 = Date.now();
  const played = await V.play(['head:L4', 'dist:150']);
  log.push('resolved ' + played);
  process.stdout.write(JSON.stringify({ log, ms: Date.now() - t0 }));
})();
"""


def run(mode):
    out = subprocess.run([NODE, "-e", RUNNER, os.path.abspath("."), mode], capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_an_interrupted_context_is_resumed_before_any_clip_is_scheduled():
    r = run("interrupted")
    assert r["log"][0] == "resumed", r
    assert not any("stopped clock" in x for x in r["log"]), r
    assert r["log"][-1] == "resolved true" and r["log"][-2] == "ended", r   # ends when the last clip has ended


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_a_context_that_wont_run_hands_the_line_to_the_device_voice():
    r = run("stuck")
    assert r["log"] == ["resolved false"], r


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_a_clip_that_never_reports_its_end_does_not_hold_the_queue():
    r = run("noend")
    assert r["log"][-1] == "resolved true" and r["ms"] < 3000, r
