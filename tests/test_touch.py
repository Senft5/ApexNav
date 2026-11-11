"""Touch (core/driver_profile.py, web/driver_profile.js): how fast the brakes go on and come off, and how fast the car is
loaded at turn-in, in g a second, from the ten g readings a second the recording keeps since #377. A rate planted in time
must be read back; g kept once a second (a staircase or a ramp between fixes) gives no touch at all; the port says the same.
"""
import json
import os
import shutil
import subprocess

import numpy as np
import pytest

from core import driver_profile as dp
from tests.test_driver_profile import entry, make_drive

NODE = shutil.which("node")


def plant(drive, on=1.5, off=0.6, turn=0.9, peak=0.5, side_peak=0.5, seed=0):
    """The drive with each corner's braking and turn-in replaced by loads that rise and fall at the given g a second, in
    the drive's own time (5 m a bin at its speed), plus 0.01 g of noise."""
    rng = np.random.default_rng(seed)
    v = np.asarray(drive["speed_mps"], dtype=float)
    lon = np.asarray(drive["lon_g"], dtype=float).copy()
    lat = np.asarray(drive["lat_g"], dtype=float).copy()
    t = np.concatenate([[0.0], np.cumsum(5.0 / v[:-1])])
    for c in drive["corners"]:
        s, a, e = c["start"], c["apex"], c["end"]
        # brakes: on from 30 bins before the apex, held, off by 4 bins before it
        tb0, tb1 = t[a - 30], t[a - 4]
        for q in range(a - 34, a + 1):
            x = t[q]
            up = (x - tb0) * on
            down = (tb1 - x) * off
            lon[q] = -max(0.0, min(peak, up, down))
        # turn-in: load building from 8 bins before the start to the apex, held to the end
        tt0 = t[s - 6]
        sign = 1.0 if c["dir"] == "L" else -1.0
        for q in range(s - 8, e + 1):
            lat[q] = sign * max(0.0, min(side_peak, (t[q] - tt0) * turn))
    lon += rng.normal(0, 0.01, len(lon))
    lat += rng.normal(0, 0.01, len(lat))
    return {**drive, "lon_g": np.round(lon, 4).tolist(), "lat_g": np.round(lat, 4).tolist()}


def test_planted_rates_are_read_back():
    # rates the 5 m bins can time (the rise takes two bins or more at the drive's speed)
    for on, off, turn in ((0.8, 0.5, 0.6), (0.4, 0.3, 0.4)):
        p = dp.profile([entry(plant(make_drive(s), on, off, turn, seed=s), s) for s in range(3)])
        t = p["touch"]
        assert t["brake_on"]["n"] >= 60 and t["turn_in"]["n"] >= 60
        assert t["brake_on"]["rate"] == pytest.approx(on, rel=0.15), t
        assert t["brake_off"]["rate"] == pytest.approx(off, rel=0.15), t
        assert t["turn_in"]["rate"] == pytest.approx(turn, rel=0.15), t
        assert t["release"] == pytest.approx(off / on, rel=0.25)
        assert t["turn_in"]["lo"] <= t["turn_in"]["rate"] <= t["turn_in"]["hi"]


def test_a_gentler_release_reads_lower():
    sharp = dp.profile([entry(plant(make_drive(s), 0.6, 0.5, seed=s), s) for s in range(3)])["touch"]
    soft = dp.profile([entry(plant(make_drive(s), 0.6, 0.15, seed=s), s) for s in range(3)])["touch"]
    assert soft["brake_off"]["rate"] < 0.5 * sharp["brake_off"]["rate"]
    assert abs(soft["brake_on"]["rate"] - sharp["brake_on"]["rate"]) < 0.1


def test_quicker_than_the_bins_can_time_is_quick_not_slow():
    # 4 g a second to 0.5 g is an eighth of a second, under one 5 m bin at these speeds: read off the bins it would come
    # out far too low, so it is "quick", and a median among the quick ones is not a number
    t = dp.profile([entry(plant(make_drive(s), 4.0, 0.5, seed=s), s) for s in range(3)])["touch"]
    assert t["brake_on"]["quick"] >= 0.5 * t["brake_on"]["n"] and t["brake_on"]["rate"] is None and t["brake_on"]["quick_rate"] is True
    assert t["brake_off"]["rate"] == pytest.approx(0.5, rel=0.15) and t["brake_off"]["quick"] == 0
    assert t["release"] is None or t["release_n"] < t["brake_off"]["n"]   # a ratio needs both timed


@pytest.mark.parametrize("kind", ["staircase", "ramp"])
def test_g_kept_once_a_second_gives_no_touch(kind):
    d = plant(make_drive(1))
    k = 3                                                 # a fix every 15 m, as older recordings at ~15 m/s
    def coarse(x):
        x = np.asarray(x)
        if kind == "staircase":
            return np.repeat(x[::k], k)[:len(x)].tolist()
        return np.round(np.interp(np.arange(len(x)), np.arange(0, len(x), k), x[::k]), 4).tolist()
    obs = dp.observe({**d, "lon_g": coarse(d["lon_g"]), "lat_g": coarse(d["lat_g"])})
    assert obs and all(o["brake_on"] is None and o["brake_off"] is None and o["turn_in"] is None for o in obs)
    assert any(o["arc"] is not None for o in obs)        # the rest of the corner is read as before
    t = dp.profile([{"id": "x", "obs": obs}])["touch"]
    assert all(t[m]["rate"] is None and t[m]["n"] == 0 for m in dp.TOUCH) and t["release"] is None


def test_unknown_stays_unknown():
    d = plant(make_drive(2, corners=9))
    t = dp.profile([entry(d, 0)])["touch"]
    assert t["brake_on"]["n"] == 9 and t["brake_on"]["rate"] is None    # under 20 corners: not said
    # a light braking (under 0.25 g) has no touch to read
    light = dp.observe(plant(make_drive(3, corners=6), peak=0.2))
    assert all(o["brake_on"] is None for o in light)


def test_unmeasured_or_stopped_bins_give_no_rate():
    # a blanked g (g_known 0, held as 0.0) just before the bins the corner itself checks, under a long steady braking:
    # it would read as a quick application; and a speed gap inside the rise would squeeze the time (a rate too high)
    base = make_drive(1, corners=6)
    d = plant(base, 0.5, 0.5, 0.6)
    lon, known = list(d["lon_g"]), [1] * len(d["lon_g"])
    for c in d["corners"]:
        a = c["apex"]
        for q in range(a - 50, a - 3):
            lon[q] = -0.45
        for q in range(a - 50, a - 40):
            lon[q], known[q] = 0.0, 0
    obs = dp.observe({**d, "lon_g": lon, "g_known": known})
    assert obs and all(o["brake_on"] is None for o in obs)
    d = plant(base, 0.4, 0.4, 0.4)
    v = list(d["speed_mps"])
    for c in d["corners"]:
        v[c["apex"] - 28] = None
        v[c["start"] - 4] = None
    timed = dp.observe(plant(base, 0.4, 0.4, 0.4))
    gap = dp.observe({**d, "speed_mps": v})
    assert any(o["brake_on"] is not None for o in timed) and all(o["brake_on"] is None and o["turn_in"] is None for o in gap)


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_parity_and_words():
    drives = [plant(make_drive(s), 0.5 + 0.4 * s, 0.4 + 0.3 * s, 0.4 + 0.2 * s, seed=s) for s in range(4)] + [make_drive(9)]
    gk = [1] * len(drives[0]["lat_g"])
    c = drives[0]["corners"][3]
    gk[c["apex"] - 46:c["apex"] - 40] = [0] * 6                  # blanked g just before the corner's own checks
    v = list(drives[1]["speed_mps"])
    v[drives[1]["corners"][2]["apex"] - 28] = None              # a speed gap inside a braking
    drives[0], drives[1] = {**drives[0], "g_known": gk}, {**drives[1], "speed_mps": v}
    meta = [{"id": f"d{i}", "month": None, "car": None, "tags": None} for i in range(len(drives))]
    py_obs = [dp.observe(d) for d in drives]
    py = dp.profile([{**m, "obs": o} for m, o in zip(meta, py_obs)])["touch"]
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const [ds,meta]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const obs=ds.map((d)=>P.observe(d));const t=P.profile(meta.map((m,i)=>({...m,obs:obs[i]}))).touch;"
              "process.stdout.write(JSON.stringify({obs,t,say:P.touchLines(t),soft:P.touchLines({brake_on:{rate:1.42},brake_off:{rate:0.634},turn_in:{rate:0.86,lo:0.52,hi:1.13},release:0.5}),"
              "sharp:P.touchLines({brake_on:{rate:0.8},brake_off:{rate:1.6},turn_in:{rate:null},release:2}),"
              "quick:P.touchLines({brake_on:{rate:null,quick_rate:true},brake_off:{rate:0.5},turn_in:{rate:null,quick_rate:true},release:null}),none:P.touchLines({brake_on:{rate:null},brake_off:{rate:null},turn_in:{rate:null},release:null})}));")
    out = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([drives, meta]), capture_output=True, text=True, check=True).stdout)
    for a, b in zip(out["obs"], py_obs):
        for x, y in zip(a, b):
            for k in dp.TOUCH:
                assert (x[k] is None) == (y[k] is None) and (y[k] is None or x[k] == pytest.approx(y[k], abs=1e-9)), k
    assert out["t"] == py
    assert out["soft"] == ["You put the brakes on at about 1.4 g a second and let them off at about 0.63 g a second.",
                           "You let the brakes go more gently than you put them on, which keeps the front tyres loaded as you turn in.",
                           "You load the car up at about 0.86 g a second as you turn in, most corners between 0.5 and 1.1."]
    assert out["sharp"][1].startswith("You let the brakes go more sharply") and len(out["sharp"]) == 2
    assert out["quick"] == ["You put the brakes on in one quick movement (quicker than the recording can time) and let them off at about 0.5 g a second.",
                            "You turn in with one quick movement of the wheel (quicker than the recording can time)."]
    assert out["none"] == [] and len(out["say"]) >= 2
    assert any(o[k] == "quick" for d in py_obs for o in d for k in dp.TOUCH)    # the parity covers quick corners too
