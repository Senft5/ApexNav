"""A drive is kept as it goes (web/drive_keep.js; Round 3, the owner's drive to work on 2026-10-30 that never reached the
Log): checkpoints rebuild the recording exactly, the shell's journal fills in what came after the last one, a drive ends
itself when the car switches off or stays parked, and nothing is invented for a gap."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const K = require(process.argv[1] + '/web/drive_keep.js'), S = require(process.argv[1] + '/web/sensors.js');
// A commute: 1 Hz fixes north at 15 m/s for 20 minutes (18 km) as the app's frames, a spike every 7th, numbered as the shell
// numbers them; a stop at the lights, then parked and the walk away at 1.3 m/s.
const T0 = Date.UTC(2026, 9, 30, 12, 40), frames = [];
let lat = 35.5, seq = 0;
const push = (v, s, n) => { for (let i = 0; i < n; i++) { seq++; lat += v / 110540; frames.push({ has_fix: true, lat, lon: -83.9, speed_mps: v, accuracy_m: 5,
  lat_g: 0.1, lon_g: 0, calibration: 'locked', camber_deg: 1.5, crest_vertical_g: 0, roughness_rms: 0.02, vert_peak_g: seq % 7 ? null : 0.4, seq, at: T0 + seq * 1000 }); } };
push(15, 0, 600); push(0, 0, 40); push(15, 0, 600);
const driving = frames.length;
push(0, 0, 30); push(1.3, 0, 900);

// the whole drive, live
const whole = new S.Recorder(); frames.slice(0, driving).forEach((f) => whole.add(f));
// the same drive, checkpointed as it went, the page closing 40 frames after its last checkpoint
const rec = new S.Recorder(), store = { head: null, chunks: [] };
let k = K.fresh(T0), last = null;
for (const f of frames.slice(0, driving)) {
  rec.add(f);
  if (K.due(k, rec, f.at)) { const cp = K.checkpoint('drive_x', rec, k, { routeName: 'To work' }, f.seq, f.at); store.head = cp.head; store.chunks.push(cp.chunk); k = cp.next; last = f.seq; }
}
const journal = frames.slice(0, driving).filter((f) => f.seq > last - 3);   // the shell's journal: everything after the last durable seq (and a little before)
const back = K.rebuild(store.head, store.chunks, journal).rec;
const fromJournal = K.rebuild(null, [], frames.slice(0, driving)).rec;
// a checkpoint chunk lost: the rows stop at the gap, nothing is drawn across it
const holed = K.rebuild(store.head, store.chunks.filter((c) => c.n !== 3), []).rec;
// the page slept from the car park on (the phone in a pocket all day): its last checkpoint, then the journal has the stop,
// the walk to the office and the day; rebuilt, the drive ends where the car last drove
const slept = (() => { const r = new S.Recorder(), w = new K.EndWatch(); let k = K.fresh(T0), head = null; const chunks = [];
  for (const f of frames.slice(0, driving - 5)) { r.add(f); w.feed(f, r.samples, f.at);
    if (K.due(k, r, f.at)) { const cp = K.checkpoint('drive_y', r, k, { watch: w.state() }, f.seq, f.at); head = cp.head; chunks.push(cp.chunk); k = cp.next; } }
  const out = K.rebuild(head, chunks, frames.filter((f) => f.seq > head.seq));
  return { rows: out.rec.samples, why: out.end && out.end.why, tail: out.rec.rows.slice(-1)[0].speed_mps }; })();

// ends: the car switched off once parked; a CarPlay drop at speed; no car screen; never moved; the car on in a queue
const run = (setup, list) => { const w = new K.EndWatch(); let out = null, n = 0; setup(w);
  for (const f of list) { n++; out = w.feed(f, n, f.at); if (out) return { ...out, at: f.at - T0 }; } return null; };
const parked = frames.slice(driving - 600);
const endCar = (() => { const w = new K.EndWatch(); w.carScreen(true, T0); let n = 0, out = null;
  for (const f of parked) { n++; if (f.seq === driving + 5) w.carScreen(false, f.at); out = w.feed(f, n, f.at); if (out) return { ...out, at: f.at - T0, seq: f.seq }; } return null; })();
const dropAtSpeed = (() => { const w = new K.EndWatch(); w.carScreen(true, T0); let n = 0;
  for (const f of frames.slice(0, 700)) { n++; if (f.seq === 300) w.carScreen(false, f.at); const out = w.feed(f, n, f.at); if (out) return { ...out, seq: f.seq }; } return null; })();
const noCar = run(() => {}, parked);
const carOn = run((w) => w.carScreen(true, T0), parked);
const never = run(() => {}, frames.slice(driving, driving + 30).map((f) => ({ ...f, speed_mps: 0, at: f.at })).concat(
  Array.from({ length: 900 }, (_, i) => ({ has_fix: true, speed_mps: 0, at: T0 + 2e6 + i * 1000 }))));

// the parked end cuts the drive back to the last moment it drove
const cut = new S.Recorder(); let cutRows = null;
{ const w = new K.EndWatch(); for (const f of frames) { cut.add(f); const e = w.feed(f, cut.samples, f.at); if (e) { cutRows = e.rows; break; } } cut.truncate(cutRows); }

console.log(JSON.stringify({
  wholeRows: whole.samples, backRows: back.samples, same: back.toCsv() === whole.toCsv(), started: back.startedAt === rec.startedAt,
  chunks: store.chunks.length, chunkRows: Math.max(...store.chunks.map((c) => c.rows.length)),
  journalSame: fromJournal.toCsv() === whole.toCsv(), journalStarted: fromJournal.startedAt === T0 + 1000,
  holedRows: holed.samples, holedTo: store.chunks.find((c) => c.n === 3).from,
  endCar, dropAtSpeed, noCar, carOn, never,
  cutKm: cut.km, wholeKm: whole.km, cutRows: cut.samples, cutTail: cut.rows.slice(-1)[0].speed_mps,
  keepable: [K.keepable(whole), K.keepable(K.rebuild(null, [], frames.slice(0, 15)).rec), K.keepable(K.rebuild(null, [], frames.slice(0, 25)).rec)], slept,
  notes: [K.endNote({ ended: 'car' }), K.endNote({ ended: 'parked' }), K.endNote({ ended: 'recovered' }), K.endNote({})],
}));
"""


@pytest.fixture(scope="module")
def out():
    res = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_checkpoints_and_the_journal_rebuild_the_drive_exactly(out):
    assert out["chunks"] > 20 and out["chunkRows"] < 400   # written as it went, only the new rows each time
    assert out["backRows"] == out["wholeRows"] > 3000
    assert out["same"] and out["started"]                   # every row and every spike, to the digit, from the drive's own start
    assert out["journalSame"] and out["journalStarted"]     # the page closed before its first checkpoint: the journal alone


def test_a_lost_chunk_stays_a_gap(out):
    assert out["holedRows"] == out["holedTo"] + 1           # kept up to the hole (the lost chunk's first row is the one before's last)


def test_the_drive_ends_when_the_car_switches_off_and_stays_put(out):
    e = out["endCar"]
    assert e and e["why"] == "car" and e["rows"] == 600          # cut back to the last frame at driving speed
    assert e["seq"] == 1240 + 5 + 20                             # 20 s after the car's screen went
    assert out["dropAtSpeed"] is None                            # a drop at speed carries on: the car drove on


def test_a_long_stop_ends_it_only_without_a_car_screen(out):
    assert out["noCar"] and out["noCar"]["why"] == "parked" and out["noCar"]["rows"] == 600
    assert out["noCar"]["at"] == (1240 + 600) * 1000              # ten minutes after it last drove (the walk is not driving)
    assert out["carOn"] is None                                   # the car's screen is on: a queue, never parking
    assert out["never"] is None                                   # a drive that never moved is never ended for it


def test_the_parked_end_leaves_out_the_walk(out):
    assert abs(out["cutKm"] - out["wholeKm"]) < 0.01 and out["cutRows"] <= out["wholeRows"]
    assert out["cutTail"] >= 2.5


def test_a_drive_recovered_after_the_page_slept_ends_where_the_car_last_drove(out):
    assert out["slept"]["why"] == "parked" and out["slept"]["tail"] >= 2.5
    assert out["slept"]["rows"] == out["wholeRows"]             # the whole drive, none of the walk


def test_a_commute_is_kept_and_a_tap_of_the_button_is_not(out):
    assert out["keepable"] == [True, False, True]                # 18 km yes; 210 m no; 360 m (60+ samples) yes


def test_the_log_says_how_a_drive_ended(out):
    assert out["notes"] == ["Ended when the car disconnected", "Ended when the car was parked",
                            "Recovered: the app closed before the drive was ended", None]


def test_the_page_and_the_shell_wire_it():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert '<script src="drive_keep.js"></script>' in html
    assert "keepStart();" in html and "keepDone(kept);" in html and "recoverKept()" in html
    assert "m.action === 'disconnect'" in html and "backlog(frames)" in html
    swift = open(os.path.join(ROOT, "ApexNavApp.swift"), encoding="utf-8").read()
    assert 'cmd == "journal"' in swift and "journal?.add(JournalFrame(" in swift and "window.apex.backlog(" in swift
    assert "didEnterBackgroundNotification" in swift and "segments, at, seq" in swift and "at: at, seq: seq)" in swift   # every frame numbered (LiveFrame)
    car = open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift"), encoding="utf-8").read()
    assert 'ApexCar.shared.send("disconnect"' in car
