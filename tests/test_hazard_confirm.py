"""Potholes on phone drives: found from the recorded vertical spike, and confirmed when your other drives find them too."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const R = require('./web/recording.js'), Core = require('./web/apex_core.js');
// a straight 1 km road north at 40 mph; `spikeAt` puts a 0.9 g hit on one 5 m sample
const csv = ({ peak = true, spikeAt = 100, reverse = false, crest = '' } = {}) => {
  const rows = Array.from({ length: 200 }, (_, k) => {
    const i = reverse ? 199 - k : k;                                   // southbound: same places, other order
    const p = !peak ? '' : (i === spikeAt ? '0.900' : '0.050');
    return `${k * 5},${35 + i * 5 / 110540},-83,40,0,0,,0.0300,${crest},${p}`;
  });
  return ['distance_m,lat,lon,speed_mph,lon_g,lat_g,camber_deg,roughness_rms,crest_vertical_g,vert_peak_g', ...rows].join('\n');
};
const out = {};
const bumps = (d) => d.events.filter((e) => e.type === 'bump').map((e) => [e.index, e.code, e.call]);
out.found = bumps(R.parse(Core, csv(), 'a.csv'));
out.noPeakColumn = bumps(R.parse(Core, csv({ peak: false }), 'b.csv'));           // roughness alone never makes a pothole
const A = R.parse(Core, csv({ spikeAt: 100 }), 'A.csv', { id: 'A' });
const B = R.parse(Core, csv({ spikeAt: 102 }), 'B.csv', { id: 'B' });            // same pothole, 10 m on (GPS)
const C = R.parse(Core, csv({ spikeAt: -1 }), 'C.csv', { id: 'C' });             // drove over it, felt nothing
const D = R.parse(Core, csv({ spikeAt: 100, reverse: true }), 'D.csv', { id: 'D' }); // other direction: other lane
const E = R.parse(Core, csv({ peak: false }), 'E.csv', { id: 'E' });              // no spike measurement: not a pass
const seen = (recs) => Object.fromEntries(R.corroborate(recs).map((d) => [d.id, d.events.filter((e) => e.type === 'bump').map((e) => [e.seen, R.seenLabel(e)])]));
out.all = seen([A, B, C, D, E]);
out.alone = seen([A]);
out.twoMiss = seen([A, C]);
out.unchanged = A.events.every((e) => !('seen' in e));
// a drive saved before hazards were detected (corners only, no version mark) is profiled again, keeping its spike column
const old = { ...B, events: B.events.filter((e) => e.type === 'corner') }; delete old.hz;
out.oldRepaired = bumps(R.repair(Core, old));
out.oldSeen = seen([A, R.repair(Core, old)]).A;
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    root = Path(__file__).resolve().parents[1]
    p = subprocess.run([NODE, "-e", RUNNER], cwd=root, capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_a_recorded_spike_becomes_a_bump_call(r):
    assert r["found"] == [[100, "BUMP", "Bump"]]
    assert r["noPeakColumn"] == []


def test_confirmed_when_another_drive_finds_it_the_same_way(r):
    assert r["all"]["A"] == [[{"hits": 2, "passes": 3}, "Confirmed on 2 of 3 drives"]]
    assert r["all"]["B"] == [[{"hits": 2, "passes": 3}, "Confirmed on 2 of 3 drives"]]
    assert r["all"]["D"] == [[{"hits": 1, "passes": 1}, "Driven once"]]          # nobody else drove it southbound
    assert r["alone"]["A"] == [[{"hits": 1, "passes": 1}, "Driven once"]]
    assert r["twoMiss"]["A"] == [[{"hits": 1, "passes": 2}, "Seen on 1 of 2 drives"]]
    assert r["unchanged"]


def test_drives_saved_before_detection_are_checked_again_not_counted_as_misses(r):
    assert r["oldRepaired"] == [[102, "BUMP", "Bump"]]
    assert r["oldSeen"] == [[{"hits": 2, "passes": 2}, "Confirmed on 2 of 2 drives"]]
