"""Track day mode (web/track_mode.js, IDEAS D-15): laps on a circuit timed at the start/finish line (crossings interpolated
between fixes), sectors after the first lap, a live delta to the best, and only on a mapped raceway."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const T = require(process.argv[1] + '/web/track_mode.js');
// a 1 km circle round (35, -83), driven anticlockwise; the start line on its south point heading east
const R = 1000 / (2 * Math.PI), c = Math.cos(35 * Math.PI / 180);
const pos = (a) => ({ lat: 35 + R * Math.sin(a) / 110540, lon: -83 + R * Math.cos(a) / (111320 * c) });
const start = pos(-Math.PI / 2);
const timer = T.createLapTimer({ lat: start.lat, lon: start.lon, headingDeg: 90 });
const laps = [], speeds = [20, 25, 24];          // m/s, one per lap: 50 s, 40 s, 41.67 s
let t = 0, a = -Math.PI / 2 - 0.3, deltas = [];
for (let lap = 0; lap < 3; lap++) {
  const v = speeds[lap], dA = v * 1 / R;                       // 1 Hz fixes
  const until = -Math.PI / 2 + 2 * Math.PI * (lap + 1);
  while (a < until) {
    a += dA; t += 1000;
    const r = timer.feed({ ...pos(a), t });
    if (r) laps.push(r.lap);
    if (lap === 2 && Math.abs(a - (until - Math.PI)) < dA) deltas.push(timer.state(t).delta);
  }
}
const pts = [[-83.0005, 34.9995], [-82.9995, 35.0005]];
console.log(JSON.stringify({ laps, state: timer.state(t), deltas, text: T.lapText(94.27),
  race: T.onRaceway([{ props: { class: 'raceway' }, lines: [pts] }], 35, -83), road: T.onRaceway([{ props: { class: 'primary' }, lines: [pts] }], 35, -83) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_laps_are_timed_to_the_line(out):
    times = [l["timeS"] for l in out["laps"]]
    assert len(times) == 3, "the drive starts just short of the line: three crossings after it end three laps"
    assert abs(times[0] - 50.0) < 0.15 and abs(times[1] - 40.0) < 0.15 and abs(times[2] - 41.67) < 0.15   # 1 Hz fixes, chords of a circle
    assert out["state"]["best"]["timeS"] == times[1]


def test_sectors_and_delta(out):
    assert out["laps"][0]["sectors"] is None, "sectors start once the first lap has placed their lines"
    s = out["laps"][1]["sectors"]
    assert s and abs(sum(s) - out["laps"][1]["timeS"]) < 0.05 and all(11 < x < 16 for x in s)
    assert out["deltas"] and 0.3 < out["deltas"][0] < 1.5, "half a lap down at 24 vs 25 m/s: about +0.8 s"


def test_only_on_a_raceway(out):
    assert out["race"] is True and out["road"] is False
    assert out["text"] == "1:34.27"
