"""Saved recordings remain replayable when older records have no envelope."""
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")


def test_legacy_recording_replay_renderers():
    root = Path(__file__).resolve().parents[1]
    script = r"""
(() => {
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('./web/recording.js');
const Core = require('./web/apex_core.js');
globalThis.ApexUnits = require('./web/units.js');
const csv = ['distance_m,lat,lon,speed_mph,lon_g,lat_g,camber_deg,roughness_rms',
  ...Array.from({length: 100}, (_, i) => `${i*5},${35+i*5/110540},-83,30,0,0,,`)].join('\n');
const record = R.parse(Core, csv, 'test.csv');
assert.equal(record.envMps.length, 100);
assert.equal(record.sightM.length, 100);
delete record.envMps; delete record.sightM;
const track = R.toTrack(record);
assert.equal(track.envMps, null);
assert.equal(track.sightM, null);
assert.equal(track.limitMps, null);
assert.equal(track.sectors, null);
assert.ok(track.camberDeg.every(v => v === null));
assert.deepEqual(track.speedMps, record.speed_mps);
// Run the actual page renderers with a legacy record, not a copy of their logic.
const html = fs.readFileSync('web/index.html', 'utf8');
const functionText = name => {
  const start = html.indexOf(`    function ${name}(`);
  return html.slice(start, html.indexOf('\n    }', start) + 6);
};
const mapReady = true, emptyFC = () => ({type:'FeatureCollection', features:[]});
let ribbon = null, lastRibbonAt = 0, ribbonKey = null, ribbonTrack = null, scrubRect = null;   // updateRibbon's own state (it sends a changed ribbon only)
const map = {getSource: () => ({setData: data => {ribbon = data;}})};
const look = {colors:{signal:'red',amber:'orange',calm:'green'}};
const scrubCanvas = {getBoundingClientRect: () => ({width:300,height:30})};
const window = {devicePixelRatio:1}, totalM = () => 495, allEvents = () => [];
const state = {cursorM:0};
const attrs = {}, $ = () => ({getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; }});
const strokes = [];
const sctx = new Proxy({}, {get: (_, key) => (...args) => {
  if (key === 'moveTo' || key === 'lineTo') {
    assert.ok(args.every(Number.isFinite)); strokes.push([key,...args]);
  }
}});
eval(functionText('updateRibbon') + '\nupdateRibbon(15, 0, true);');
assert.deepEqual(ribbon, emptyFC());
eval(functionText('paintScrubValue') + functionText('drawScrubber') + '\ndrawScrubber();');
assert.equal(strokes.length, 0); // no fabricated zero-speed envelope
assert.equal(attrs['aria-valuetext'], '0.0 of 0.3 mi'); // what VoiceOver reads on the scrubber
track.envMps = Array(100).fill(null);
track.envMps[0] = 20; track.envMps[1] = 20;
track.envMps[3] = 20; track.envMps[4] = 20;
eval(functionText('updateRibbon') + '\nupdateRibbon(15, 0, true);');
assert.equal(ribbon.features.length, 2); // missing bin breaks the ribbon
eval(functionText('paintScrubValue') + functionText('drawScrubber') + '\ndrawScrubber();');
assert.deepEqual(strokes.map(s => s[0]), ['moveTo','lineTo','moveTo','lineTo']);
})();
"""
    result = subprocess.run([NODE, "-e", script], cwd=root, capture_output=True,
                            text=True, encoding="utf-8", timeout=30)
    assert result.returncode == 0, result.stderr


def test_live_recording_with_blank_camber_scores_a_number():
    # The phone recorder writes camber_deg blank on every row (and sometimes a blank speed or roughness). That made every corner's
    # limit NaN and the Log showed "Score NaN" after a drive (owner, iOS 2026-10-26).
    root = Path(__file__).resolve().parents[1]
    script = r"""
const assert = require('node:assert/strict');
const R = require('./web/recording.js'), Core = require('./web/apex_core.js');
const rows = ['segment_index,distance_m,lat,lon,elevation_m,speed_mph,lon_g,lat_g,camber_deg,roughness_rms,source'];
for (let i = 0; i < 800; i++) {
  const x = i * 5, sp = i % 37 === 0 ? '' : (28 + 6 * Math.cos(x / 25)).toFixed(2), rough = i % 11 === 0 ? '' : '0.1';
  rows.push([i, x, (35 + 40 * Math.sin(x / 50) / 110540).toFixed(7), (-83 + x / 91000).toFixed(7), '', sp, '0.05', (0.3 * Math.sin(x / 50)).toFixed(4), '', rough, 'web-gps'].join(','));
}
const d = R.parse(Core, rows.join('\n') + '\n', 'web_20261026_170300.csv', { source: 'web-gps' });
assert.ok(d.envMps.every(Number.isFinite), 'envelope has no NaN');
assert.ok(d.camber.every((v) => v === null), 'unknown camber stays unknown in the record');
const corners = d.events.map((e) => ({ start: Math.round(e.start_m / 5), end: Math.round(e.end_m / 5), apex: e.index, apex_mps: e.apex_mph / 2.2369362921 }));
assert.ok(corners.length > 10 && corners.every((c) => Number.isFinite(c.apex_mps)));
const ds = Core.driverScore(d.speed_mps, d.lon_g, d.lat_g, corners);
assert.ok(Number.isInteger(ds.score) && ds.score > 0 && ds.score <= 1000, 'score ' + ds.score);
assert.ok(ds.corners < corners.length, 'corners with a blank speed are left out');
// A drive saved by the old code (NaN corner limits, null envelope) is profiled again when loaded; a healthy one is untouched.
const old = { ...d, events: d.events.map((e) => ({ ...e, apex_mph: NaN })), envMps: d.envMps.map(() => null) };
const fixed = R.repair(Core, old);
assert.deepEqual(fixed.events.map((e) => e.apex_mph), d.events.map((e) => e.apex_mph));
assert.deepEqual(fixed.envMps, d.envMps);
assert.equal(R.repair(Core, d), d);
assert.equal(d.g_known, null, 'all g measured: no mask');
// g blank before calibration (first half): those corners are not scored as perfectly smooth zeros
const half = rows.map((l, i) => { if (i === 0 || i > 400) return l; const c = l.split(','); c[6] = ''; c[7] = ''; return c.join(','); });
const h = R.parse(Core, half.join('\n') + '\n', 'web_20261026_170300.csv', { source: 'web-gps' });
assert.ok(h.g_known && h.g_known.slice(0, 400).every((v) => v === 0) && h.g_known.slice(400).every((v) => v === 1));
const hc = h.events.map((e) => ({ start: Math.round(e.start_m / 5), end: Math.round(e.end_m / 5), apex: e.index, apex_mps: e.apex_mph / 2.2369362921 }));
const kept = R.scorableCorners(h, hc);
assert.ok(kept.length > 0 && kept.length < hc.length && kept.every((c) => c.start >= 400));
"""
    result = subprocess.run([NODE, "-e", script], cwd=root, capture_output=True,
                            text=True, encoding="utf-8", timeout=30)
    assert result.returncode == 0, result.stderr
