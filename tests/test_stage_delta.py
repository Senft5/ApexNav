"""Live delta on a saved stage (web/stage_delta.js, IDEAS D-05): technique against your best pass, corner by corner.
A smoother pass shows ahead, a rougher one behind, the same pass level; the wrong direction or another road never starts it."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const R = process.argv[1];
const Core = require(R + '/web/apex_core.js'), Rec = require(R + '/web/recording.js'), S = require(R + '/web/stage_delta.js');
const MPH = 2.2369362921;
// A winding road: 5 m steps, heading swinging left and right (esses), about 3 km, plus a straight run-in and run-out.
function road() {
  const lat = [], lon = []; let la = 35.6, lo = -83.9, h = 0;
  for (let i = 0; i < 800; i++) {
    const inStage = i > 100 && i < 700;
    h += inStage ? 0.05 * Math.sin((i - 100) / 25) : 0;
    la += 5 * Math.cos(h) / 110540; lo += 5 * Math.sin(h) / (111320 * Math.cos(35.6 * Math.PI / 180));
    lat.push(la); lon.push(lo);
  }
  return { lat, lon };
}
// A pass: speed eases with curvature; lateral g from v^2 k, with `jitter` g of chatter (rougher hands) at a fixed seed.
function pass({ lat, lon }, jitter, seed = 1) {
  const { kappa } = Core.computeCurvature(lat, lon);
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const v = kappa.map((k) => Math.max(9, 22 - 300 * Math.abs(k)));
  const latG = v.map((x, i) => x * x * kappa[i] / 9.80665 + jitter * rnd());
  const lonG = v.map((x, i) => (i ? (x * x - v[i - 1] ** 2) / (2 * 5) / 9.80665 : 0));
  return { v, latG, lonG };
}
function drive(id, rd, p) {
  const prof = Core.profileRecording({ lat: rd.lat, lon: rd.lon, distance_m: rd.lat.map((_, i) => i * 5), speed_mph: p.v.map((x) => x * MPH), lon_g: p.lonG, lat_g: p.latG });
  const d = { id, lat: rd.lat, lon: rd.lon, dist: rd.lat.map((_, i) => i * 5), speed_mps: p.v, lon_g: p.lonG, lat_g: p.latG, events: prof.events, g_known: null };
  d.corners = Rec.scorableCorners(d, Rec.cornersOf(d));
  return d;
}
const rd = road();
const a = 110, b = 690;
const seg = { id: 'seg_1', name: 'Esses', lat0: rd.lat[a], lon0: rd.lon[a], lat1: rd.lat[b], lon1: rd.lon[b], length_m: (b - a) * 5,
  geom: JSON.stringify(Array.from({ length: 60 }, (_, k) => { const i = a + Math.round(k * (b - a) / 59); return [rd.lat[i], rd.lon[i]]; })) };
const bestD = drive('best', rd, pass(rd, 0.04, 7)), worseD = drive('worse', rd, pass(rd, 0.25, 3));
const refs = [S.reference(Core, seg, bestD, bestD.corners), S.reference(Core, seg, worseD, worseD.corners)];
const out = { corners: refs[0] && refs[0].corners.length, picked: S.best(refs).driveId, worseScore: refs[1].score, bestScore: refs[0].score };
const rowsOf = (rdx, p) => rdx.lat.map((_, i) => ({ lat: rdx.lat[i], lon: rdx.lon[i], speed_mps: p.v[i], lat_g: p.latG[i], lon_g: p.lonG[i] }));
function live(rows, refsUse) {
  const tr = S.createTracker(Core, refsUse), seen = [];
  const got = [];
  for (let i = 0; i < rows.length; i += 4) { const r = tr.update(rows.slice(0, i + 1)); if (r) got.push(r); }
  return { first: got.find((g) => g.state === 'in') || null, last: got[got.length - 1] || null, dones: got.filter((g) => g.state === 'done').length,
           mid: got.filter((g) => g.state === 'in' && g.delta != null).map((g) => g.delta) };
}
const best = [S.best(refs)];
out.same = live(rowsOf(rd, pass(rd, 0.04, 7)), best);
out.rough = live(rowsOf(rd, pass(rd, 0.25, 11)), best);
out.smoother = live(rowsOf(rd, pass(rd, 0.0, 5)), [refs[1]]);
const back = { lat: rd.lat.slice().reverse(), lon: rd.lon.slice().reverse() };
out.backwards = live(rowsOf(back, pass(back, 0.04, 7)), best);
const elsewhere = { lat: rd.lat.map((x) => x + 0.05), lon: rd.lon };
out.elsewhere = live(rowsOf(elsewhere, pass(elsewhere, 0.04, 7)), best);
out.labels = [S.label(12), S.label(-8), S.label(0), S.label(null)];
out.noCover = S.reference(Core, { ...seg, lat0: 36.5, lat1: 36.6 }, bestD, bestD.corners);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_reference_and_best(out):
    assert out["corners"] >= 6
    assert out["bestScore"] > out["worseScore"]
    assert out["picked"] == "best"


def test_the_same_pass_is_level_and_ends_once(out):
    s = out["same"]
    assert s["first"]["name"] == "Esses" and s["first"]["of"] == out["corners"]
    assert s["last"]["state"] == "done" and s["dones"] == 1
    assert s["last"]["delta"] == 0 and s["last"]["done"] == out["corners"]


def test_rougher_is_behind_smoother_is_ahead(out):
    assert out["rough"]["last"]["delta"] < 0
    assert out["smoother"]["last"]["delta"] > 0
    assert out["rough"]["mid"], "the delta shows during the stage, not only at the end"


def test_wrong_way_or_another_road_never_starts(out):
    assert out["backwards"]["first"] is None and out["backwards"]["dones"] == 0
    assert out["elsewhere"]["first"] is None


def test_labels_and_unknown(out):
    assert out["labels"] == ["+12 vs best", "−8 vs best", "level with best", "--"]
    assert out["noCover"] is None
