"""Low-power cockpit (web/power.js): when the battery saver turns on and off, and the 30 fps camera gate."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const P = require(process.argv[1]);
const out = {};
// Feed a list of inputs and record `low` after each.
function run(steps) { const p = new P.PowerSaver(); return steps.map((s) => (p.update(s), p.low ? 1 : 0)); }
out.thermal = run([{ thermal: 0 }, { thermal: 1 }, { thermal: 2 }, { thermal: 3 }, { thermal: 2 }, { thermal: 1 }, { thermal: 0 }]);
out.lpm = run([{ lowPowerMode: true }, {}, { lowPowerMode: false }]);
out.battery = run([{ batteryLevel: 0.5, charging: false }, { batteryLevel: 0.2, charging: false }, { batteryLevel: 0.22, charging: false },
                   { batteryLevel: 0.25, charging: false }, { batteryLevel: 0.1, charging: false }, { batteryLevel: 0.1, charging: true }]);
out.unknown = run([{}, { thermal: null, lowPowerMode: null, batteryLevel: NaN }, { batteryLevel: 0.1 }]);
out.missingKeeps = run([{ thermal: 3 }, { lowPowerMode: false }, { batteryLevel: 0.9 }]);
const p = new P.PowerSaver();
out.changed = [p.update({ thermal: 2 }), p.update({ thermal: 3 }), p.update({ thermal: 0 })];
const r = new P.PowerSaver(); r.update({ thermal: 3, lowPowerMode: true }); out.reasons = [r.reason];
r.update({ thermal: 0 }); out.reasons.push(r.reason); r.update({ lowPowerMode: false }); out.reasons.push(r.reason);
// Frame gate at 60 Hz and 120 Hz for one second.
function drawn(hz, low) {
  const g = new P.PowerSaver(); if (low) g.update({ thermal: 3 });
  let n = 0; for (let i = 0; i < hz; i++) if (g.frameDue(i * 1000 / hz)) n++; return n;
}
out.fps = [drawn(60, false), drawn(60, true), drawn(120, true)];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r():
    out = subprocess.run([NODE, "-e", RUNNER, os.path.abspath("web/power.js")], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_hot_phone_saves_power_until_fair(r):
    assert r["thermal"] == [0, 0, 0, 1, 0, 0, 0], "only critical, the highest level, turns it on (the owner, 2026-10-31)"
    assert r["changed"] == [False, True, True]



def test_low_power_mode_and_battery_with_hysteresis(r):
    assert r["lpm"] == [1, 1, 0], "a frame without the field keeps the last value"
    assert r["battery"] == [0, 1, 1, 0, 1, 0], "on at 20 %, off at 25 % or when charging"


def test_unknown_never_turns_it_on(r):
    assert r["unknown"] == [0, 0, 0], "a level without charging state is not enough"
    assert r["missingKeeps"] == [1, 1, 1]


def test_reason_names_the_cause(r):
    assert r["reasons"] == ["Phone is warm", "Low Power Mode", None]


def test_camera_drops_to_30_fps(r):
    assert r["fps"][0] == 60
    assert 29 <= r["fps"][1] <= 31 and 29 <= r["fps"][2] <= 31
