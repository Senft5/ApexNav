"""Convoy voice (web/convoy_voice.js, docs/CONVOY_VOICE.md): who to listen to, the Opus settings written into the SFU's
answer, the one key's words, and a full join / listen / mute / duck / leave run against fake WebRTC, microphone and API."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const V = require(process.argv.at(-1));
const out = {};
const voice = new Map([['me', {}], ['ana', {}], ['ben', {}]]);
out.pull = V.toPull(voice, 'me', new Map([['ben', {}]]));
out.duck = [V.duckLevel(true), V.duckLevel(false)];
out.opus = V.speechOpus('m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n');
out.opusNoFmtp = V.speechOpus('a=rtpmap:109 opus/48000/2\r\n');
out.keys = [V.keyText('off', false).text, V.keyText('starting', false).text, V.keyText('on', false), V.keyText('on', true).text, V.keyText('failed', false).text];
const members = new Map([['ana', { handle: 'ana' }], ['ben', { handle: 'ben' }], ['cy', { handle: null }], ['dee', { handle: 'dee' }]]);
out.talking = [V.talkingText([], members), V.talkingText(['ana'], members), V.talkingText(['ana', 'cy'], members), V.talkingText(['ana', 'ben', 'dee'], members)];

// ---- a run with fakes ----
const calls = [], native = [], sent = [];
let speaking = false, timerFn = null;
class Track { constructor() { this.enabled = true; this.stopped = false; } stop() { this.stopped = true; } }
const mic = new Track();
const media = { getUserMedia: async (c) => { out.constraints = c; return { getAudioTracks: () => [mic], getTracks: () => [mic] }; } };
class PC {
  constructor(cfg) { out.ice = cfg.iceServers; this.closed = false; this.connectionState = 'new'; PC.last = this; this.remote = []; }
  addTransceiver(track, o) { out.direction = o.direction; return { mid: '0', sender: { getParameters: () => ({ encodings: [{}] }), setParameters: async (p) => { out.maxBitrate = p.encodings[0].maxBitrate; } } }; }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' }; }
  async setLocalDescription(d) { this.localDescription = d; }
  async setRemoteDescription(d) {
    this.remote.push(d);
    if (d.type === 'offer') for (const mid of ['1', '2']) this.ontrack({ transceiver: { mid }, streams: [{ id: 's' + mid }], track: {} });
  }
  close() { this.closed = true; }
}
class Gain { constructor() { this.gain = { value: 1, setTargetAtTime: (v) => { this.gain.value = v; } }; } connect() {} disconnect() {} }
class Analyser { constructor() { this.fftSize = 512; this.level = 0; } connect() {} disconnect() {} getFloatTimeDomainData(b) { b.fill(this.level); } }
const analysers = [];
class Ctx { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; } createGain() { return (this.g = new Gain()); }
  createAnalyser() { const a = new Analyser(); analysers.push(a); return a; } createMediaStreamSource() { return { connect() {}, disconnect() {} }; } }
class El { constructor() { this.muted = false; } play() { return Promise.resolve(); } pause() {} }
const apiFetch = async (path, init) => {
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push([init.method, path, body]);
  let j = {};
  if (init.method === 'POST' && path.endsWith('/voice')) j = { sdp: { type: 'answer', sdp: 'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 useinbandfec=1\r\n' }, voice: [{ key: 'ana', muted: false }] };
  if (path.endsWith('/voice/pull')) j = { sdp: { type: 'offer', sdp: 'pull' }, tracks: body.keys.map((k, i) => ({ key: k, mid: String(i + 1) })) };
  return { ok: true, status: 200, json: async () => j };
};
const client = { id: 'room1', ctx: { you: 'me' }, voice: new Map([['ana', { key: 'ana', muted: false }], ['ben', { key: 'ben', muted: false }]]),
                 members, send: (m) => { sent.push(m); return true; } };
const v = new V.ConvoyVoice({ client, apiFetch, speaking: () => speaking, native: (on) => native.push(on), media, RTC: PC, AudioCtx: Ctx, AudioEl: El,
                              setTimer: (f) => { timerFn = f; return 1; }, clearTimer: () => { timerFn = null; } });
(async () => {
  out.supported = v.supported;
  out.unsupported = new V.ConvoyVoice({ client, apiFetch, media: null, RTC: null }).supported;
  await v.press();
  out.state = v.state;
  out.calls = calls.map((c) => [c[0], c[1]]);
  out.startBody = calls[0][2];
  out.answerFixed = PC.last.remote[0].sdp;
  out.heard = [...v.remotes.keys()];
  out.elMuted = [...v.remotes.values()].map((r) => r.el.muted);   // the graph plays it, so it can be ducked
  out.native = native.slice();
  out.sentFirst = sent[0];
  speaking = true; timerFn();
  out.ducked = v.master.gain.value;
  speaking = false; timerFn();
  out.unducked = v.master.gain.value;
  analysers[0].level = 0.1; timerFn();
  out.talkingNow = v.talking.slice();
  await v.press();
  out.muted = [v.muted, mic.enabled, sent.at(-1)];
  v.onVoice({ type: 'voice', key: 'ana', on: false });
  out.afterOff = [...v.remotes.keys()];
  v.stop();
  await new Promise((r) => setTimeout(r, 0));
  out.stopped = [v.state, mic.stopped, PC.last.closed, native.at(-1), calls.at(-1)[0], timerFn === null];
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out():
    r = subprocess.run([NODE, "-e", RUNNER, "--", str(ROOT / "web" / "convoy_voice.js")], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_listens_to_everyone_on_the_channel_but_us_and_who_we_hear(out):
    assert out["pull"] == ["ana"]


def test_ducks_under_the_co_driver(out):
    duck, full = out["duck"]
    assert 0 < duck < 0.5 and full == 1


def test_opus_is_mono_with_dtx_and_a_bitrate_cap(out):
    fmtp = [line for line in out["opus"].split("\r\n") if line.startswith("a=fmtp:111")][0]
    for p in ("usedtx=1", "stereo=0", "maxaveragebitrate=24000", "useinbandfec=1", "minptime=10"):
        assert p in fmtp
    assert "a=fmtp:109 usedtx=1" in out["opusNoFmtp"]


def test_one_key_words(out):
    off, starting, on, muted, failed = out["keys"]
    assert (off, starting, muted, failed) == ("Talk", "Joining…", "Unmute", "Talk")
    assert on["text"] == "Mute" and on["on"] is True


def test_talking_line(out):
    assert out["talking"] == ["", "@ana talking", "@ana, Someone talking", "@ana, @ben +1 talking"]


def test_join_listen_mute_duck_leave(out):
    assert out["supported"] is True and out["unsupported"] is False
    assert out["state"] == "on"
    # the phone's own voice processing does the noise work: no button needed
    assert out["constraints"]["audio"] == {"echoCancellation": True, "noiseSuppression": True, "autoGainControl": True, "channelCount": 1}
    assert out["ice"] == [{"urls": "stun:stun.cloudflare.com:3478"}]
    assert out["direction"] == "sendonly" and out["maxBitrate"] == 24000
    assert out["calls"] == [["POST", "/api/convoy/room1/voice"], ["POST", "/api/convoy/room1/voice/pull"], ["PUT", "/api/convoy/room1/voice/answer"]]
    assert out["startBody"] == {"sdp": {"type": "offer", "sdp": "offer-sdp"}, "mid": "0"}
    assert "usedtx=1" in out["answerFixed"]
    assert sorted(out["heard"]) == ["ana", "ben"]
    assert out["elMuted"] == [True, True]
    assert out["native"] == [True]
    assert out["sentFirst"] == {"type": "voice", "muted": False}
    assert out["ducked"] < 0.5 and out["unducked"] == 1
    assert out["talkingNow"] == ["ana"]
    assert out["muted"] == [True, False, {"type": "voice", "muted": True}]
    assert out["afterOff"] == ["ben"]
    assert out["stopped"] == ["off", True, True, False, "DELETE", True]
