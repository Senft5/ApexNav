"""Convoy client (web/convoy.js): polyline round trip, projection on the shared route, which hazards count as ahead,
time gaps, spoken phrases, and the socket client's handshake, replay, dedupe, retraction and reconnect (fake socket)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const C = require(process.argv[2]);
const out = {};
// a straight road north from 35.0, -83.0: ~5 km in 25 m steps
const road = Array.from({ length: 201 }, (_, i) => [35 + i * 0.000225, -83]);
const ri = C.routeIndex(road);
out.lengthM = ri.lengthM;
const back = C.decodePolyline(C.encodePolyline(road));
out.roundTrip = Math.max(...back.map((p, i) => Math.abs(p[0] - road[i][0]) + Math.abs(p[1] - road[i][1])));
out.thinned = C.thin(road, 100).length;
out.proj = C.project(ri, { lat: 35.0045, lon: -82.9995 });   // ~500 m up, ~45 m east of the road
// relevance: on the route, same version
const hz = (progressM, lat = 35.01, lon = -83, routeVersion = 3) => ({ anchor: { lat, lon, progressM, routeVersion } });
const me = { lat: 35.0045, lon: -83, progressM: 500, routeDistM: 2, heading: 0, speedMps: 20 };
out.ahead = C.hazardAhead(hz(1500), me, 3);
out.behind = C.hazardAhead(hz(400), me, 3);
out.tooFar = C.hazardAhead(hz(5000), me, 3);
out.otherVersion = C.hazardAhead(hz(1500, 35.0135), me, 4);          // falls back to geometry: 1 km ahead, north, heading north
out.otherVersionBehind = C.hazardAhead(hz(1500, 34.995), me, 4);     // 1 km south while heading north
out.offRoute = C.hazardAhead(hz(1500, 35.0135), { ...me, routeDistM: 200 }, 3);
out.noHeadingFar = C.hazardAhead({ anchor: { lat: 35.0135, lon: -83 } }, { lat: 35.0045, lon: -83 }, null);
out.noHeadingNear = C.hazardAhead({ anchor: { lat: 35.0065, lon: -83 } }, { lat: 35.0045, lon: -83 }, null);
// gaps
out.gapAhead = C.gapText(C.gap({ progressM: 900 }, { progressM: 500, speedMps: 20 }));
out.gapBehind = C.gapText(C.gap({ progressM: 100 }, { progressM: 500, speedMps: 20 }));
out.gapStopped = C.gapText(C.gap({ progressM: 900 }, { progressM: 500, speedMps: 0 }));
out.gapSlow = C.gapText(C.gap({ progressM: 900 }, { progressM: 500, speedMps: 3 }));
out.phrases = [C.hazardPhrase('gravel', 50), C.hazardPhrase('gravel', 130), C.hazardPhrase('police', 1609), C.hazardPhrase('bump', 3000), C.hazardPhrase('stopped', null)];

// ---- the client against a fake socket and fake API ----
const sockets = [], calls = [];
class FakeWS { constructor(url) { this.url = url; this.sent = []; sockets.push(this); setTimeout(() => this.onopen && this.onopen(), 0); }
  send(s) { this.sent.push(JSON.parse(s)); } close() { this.closed = true; } }
const resp = (status, body) => ({ status, ok: status < 300, json: async () => body });
let ticketStatus = 201;
const apiFetch = async (path, init) => { calls.push([init.method, path]);
  if (path === '/api/convoy') return resp(201, { invite: 'ROOM.secret', context: ctx(1) });
  if (path.endsWith('/ticket')) return resp(ticketStatus, { ticket: 't' + calls.length });
  return resp(200, {}); };
const ctx = (epoch) => ({ sessionId: 'ROOM', name: 'Run', leaderEpoch: epoch, role: 'leader', you: 'me', leaderKey: 'me', expiresAtMs: 9e15, seq: 0,
                          members: [{ key: 'me', role: 'leader', online: true }, { key: 'f1', role: 'member', online: false }] });
const timers = [];
const hazards = [], retracts = [];
let now = 1000;
const client = new C.ConvoyClient({ apiFetch, wsUrl: (id) => 'wss://x/' + id, WebSocketImpl: FakeWS, now: () => now,
  setTimer: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, clearTimer: () => {},
  onHazard: (e) => hazards.push(e.eventId), onRetract: (e) => retracts.push(e.eventId) });
const tick = () => new Promise((r) => setTimeout(r, 5));
const ev = (id, seq, action = 'hazard', epoch = 1) => ({ eventId: id, seq, action, leaderEpoch: epoch, type: 'bump', expiresAtMs: 9e15, anchor: action === 'hazard' ? { lat: 1, lon: 2 } : null });
(async () => {
  await client.start('Run');
  await tick();
  const ws = sockets[0];
  out.url = ws.url;
  out.auth = ws.sent[0];
  // a hazard called before ready is queued, then sent on ready
  out.queuedId = client.callHazard('gravel', { lat: 35, lon: -83 });
  out.sentBeforeReady = ws.sent.length;
  ws.onmessage({ data: JSON.stringify({ type: 'ready', context: ctx(1), events: [ev('a', 1)], positions: [{ key: 'f1', lat: 1, lon: 2, at: 1 }], route: null, regroup: null }) });
  out.status = client.status;
  out.flushed = ws.sent.slice(1).map((m) => m.type + ':' + m.event.type);
  ws.onmessage({ data: JSON.stringify({ type: 'event', event: ev('a', 1) }) });          // duplicate
  ws.onmessage({ data: JSON.stringify({ type: 'event', event: ev('b', 2) }) });
  ws.onmessage({ data: JSON.stringify({ type: 'event', event: ev('b', 3, 'retract') }) });
  ws.onmessage({ data: JSON.stringify({ type: 'event', event: ev('b', 2) }) });          // late copy after the retraction
  out.hazards = hazards.slice(); out.retracts = retracts.slice();
  out.live = client.liveHazards().map((e) => e.eventId);
  // positions: at most one a second
  now = 5000; out.pos1 = client.sendPosition({ lat: 35, lon: -83, heading: 10, speedMps: 20 });
  now = 5500; out.pos2 = client.sendPosition({ lat: 35, lon: -83 });
  // the network drops: reconnect after a backoff, resuming from the last seq in the same epoch
  ws.onclose({ code: 1006 });
  out.afterDrop = client.status;
  out.backoff = timers.map((t) => t[1]);
  timers[0][0](); await tick(); await tick();
  out.resume = sockets[1].sent[0];
  // the server restarted: new epoch, old events are void
  sockets[1].onmessage({ data: JSON.stringify({ type: 'ready', context: ctx(2), events: [], positions: [], route: null, regroup: null }) });
  out.liveAfterRestart = client.liveHazards().length;
  // removal closes with 4403: stop, no reconnect
  sockets[1].onclose({ code: 4403 });
  out.removed = client.status; out.timersAfterRemoval = timers.length;
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def out(tmp_path_factory):
    runner = tmp_path_factory.mktemp("convoy") / "run.js"
    runner.write_text(RUNNER)
    mod = os.path.join(os.path.dirname(__file__), "..", "web", "convoy.js")
    r = subprocess.run([NODE, str(runner), os.path.abspath(mod)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_geometry(out):
    assert 4990 < out["lengthM"] < 5020
    assert out["roundTrip"] < 2e-5
    assert out["thinned"] < 60
    assert abs(out["proj"]["progressM"] - 500) < 3 and 40 < out["proj"]["distM"] < 50


def test_which_hazards_are_ahead(out):
    assert abs(out["ahead"] - 1000) < 1
    assert out["behind"] is None and out["tooFar"] is None
    assert 990 < out["otherVersion"] < 1010
    assert out["otherVersionBehind"] is None
    assert out["offRoute"] is not None and out["offRoute"] > 900   # off the route: straight line, still ahead
    assert out["noHeadingFar"] is None
    assert 200 < out["noHeadingNear"] < 250


def test_gaps_and_phrases(out):
    assert out["gapAhead"] == "20 s ahead"
    assert out["gapBehind"] == "20 s behind"
    assert out["gapStopped"] == "0.2 mi ahead"       # stopped: distance, not time
    assert out["gapSlow"] == "50 s ahead"          # speed floored at 8 m/s, so a crawl does not blow the gap up
    assert out["phrases"] == ["Gravel, now.", "Gravel ahead, 400 feet.", "Police ahead, 1 mile.", "Bump ahead, 1.9 miles.", "Stopped car reported."]


def test_client_handshake_and_queue(out):
    assert out["url"] == "wss://x/ROOM"
    assert out["auth"]["type"] == "authenticate" and out["auth"]["afterSeq"] == 0
    assert out["sentBeforeReady"] == 1 and out["status"] == "live"
    assert out["flushed"] == ["publish:gravel"]


def test_client_dedupe_and_retraction(out):
    assert out["hazards"] == ["a", "b"]
    assert out["retracts"] == ["b"]
    assert out["live"] == ["a"]


def test_client_positions_reconnect_and_epochs(out):
    assert out["pos1"] is True and out["pos2"] is False
    assert out["afterDrop"] == "reconnecting" and out["backoff"] == [1000]
    assert out["resume"]["epoch"] == 1 and out["resume"]["afterSeq"] == 3
    assert out["liveAfterRestart"] == 0
    assert out["removed"] == "removed" and out["timersAfterRemoval"] == 1
