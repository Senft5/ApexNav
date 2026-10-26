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
let ribbon = null, lastRibbonAt = 0;
const map = {getSource: () => ({setData: data => {ribbon = data;}})};
const look = {colors:{signal:'red',amber:'orange',calm:'green'}};
const scrubCanvas = {getBoundingClientRect: () => ({width:300,height:30})};
const window = {devicePixelRatio:1}, totalM = () => 495, allEvents = () => [];
const state = {cursorM:0};
const strokes = [];
const sctx = new Proxy({}, {get: (_, key) => (...args) => {
  if (key === 'moveTo' || key === 'lineTo') {
    assert.ok(args.every(Number.isFinite)); strokes.push([key,...args]);
  }
}});
eval(functionText('updateRibbon') + '\nupdateRibbon(15, 0, true);');
assert.deepEqual(ribbon, emptyFC());
eval(functionText('drawScrubber') + '\ndrawScrubber();');
assert.equal(strokes.length, 0); // no fabricated zero-speed envelope
track.envMps = Array(100).fill(null);
track.envMps[0] = 20; track.envMps[1] = 20;
track.envMps[3] = 20; track.envMps[4] = 20;
eval(functionText('updateRibbon') + '\nupdateRibbon(15, 0, true);');
assert.equal(ribbon.features.length, 2); // missing bin breaks the ribbon
eval(functionText('drawScrubber') + '\ndrawScrubber();');
assert.deepEqual(strokes.map(s => s[0]), ['moveTo','lineTo','moveTo','lineTo']);
})();
"""
    result = subprocess.run([NODE, "-e", script], cwd=root, capture_output=True,
                            text=True, encoding="utf-8", timeout=30)
    assert result.returncode == 0, result.stderr
