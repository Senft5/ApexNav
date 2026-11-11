"""Brake heat (core/brake_heat.py, its port web/brake_heat.js): energy that goes faster than rolling and air take it
went into the discs. Pure; the two are held to one sequence; unknown stays unknown; the driver hears words, not degrees."""
import json
import math
import os
import random
import re
import shutil
import subprocess

import pytest

from core.brake_heat import BrakeHeat, HOT_K, WARM_K, level, over_track, tau_s

NODE = shutil.which("node")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def hairpins(i):
    """Spirited: 25 m/s braked to 10 m/s in 4 s, back up over 16 s, every 20 s."""
    t = i % 20
    return 25 - 15 * (t / 4) if t < 4 else 10 + 15 * ((t - 4) / 16)


def drive(seq, dt=1.0):
    b = BrakeHeat()
    return b, [b.step(dt, v, h) for v, h in seq]


def test_cruising_on_the_flat_with_gps_jitter_stays_cool():
    rnd = random.Random(1)
    b, out = drive([(30 + rnd.gauss(0, 0.2), 100 + rnd.gauss(0, 3)) for _ in range(1200)])
    assert max(o["rise_k"] for o in out) < 60
    assert not any(o["call"] for o in out)
    assert out[-1]["level"] == "cool"


def test_a_spirited_descent_gets_hot_and_is_called_once():
    b, out = drive([(hairpins(i), 1000 - 0.07 * 15 * i) for i in range(480)])
    assert sum(o["call"] for o in out) == 1
    first = next(i for i, o in enumerate(out) if o["call"])
    assert out[first]["level"] == "hot" and out[first]["rise_k"] >= HOT_K
    assert b.peak >= HOT_K


def test_the_same_driving_on_the_flat_is_cooler_than_downhill():
    _, down = drive([(hairpins(i), 1000 - 0.07 * 15 * i) for i in range(480)])
    _, flat = drive([(hairpins(i), 100) for i in range(480)])
    assert max(o["rise_k"] for o in flat) < max(o["rise_k"] for o in down)


def test_a_gentle_descent_warms_but_does_not_call():
    _, out = drive([(15, 1000 - 0.08 * 15 * i) for i in range(360)])
    assert out[-1]["level"] == "warm"
    assert not any(o["call"] for o in out)


def test_climbing_and_accelerating_is_never_brake_work():
    _, out = drive([(10 + 0.05 * i, 100 + 0.06 * 10 * i) for i in range(300)])
    assert all(o["power_wkg"] in (None, 0.0) for o in out)
    assert out[-1]["rise_k"] == 0.0


def test_unknown_before_anything_is_known_and_cooling_without_height():
    b = BrakeHeat()
    assert b.step(1.0, None, None) == {"rise_k": None, "power_wkg": None, "level": None, "call": False}
    assert b.step(1.0, 20.0, None)["rise_k"] is None           # speed alone is not energy
    _, out = drive([(hairpins(i), 1000 - 0.07 * 15 * i) for i in range(300)])
    b2 = BrakeHeat()
    for v, h in [(hairpins(i), 1000 - 0.07 * 15 * i) for i in range(300)]:
        b2.step(1.0, v, h)
    hot = b2.rise
    o = b2.step(30.0, 20.0, None)                              # height lost: the discs only cool
    assert o["power_wkg"] is None and o["rise_k"] < hot


def test_a_jump_in_height_after_a_gap_is_not_energy():
    b = BrakeHeat()
    for _ in range(10):
        b.step(1.0, 20.0, 500.0)
    b.step(10.0, 20.0, None)
    o = b.step(1.0, 20.0, 200.0)                                # 300 m lower after a tunnel: a new baseline
    assert o["power_wkg"] is None
    assert o["rise_k"] < 5


def test_rearms_only_after_cooling_and_three_minutes():
    seq = [(hairpins(i), 2000 - 0.07 * 15 * i) for i in range(480)] + [(20, 1496)] * 400 + \
          [(hairpins(i), 1496 - 0.07 * 15 * i) for i in range(480)]
    _, out = drive(seq)
    calls = [i for i, o in enumerate(out) if o["call"]]
    assert len(calls) == 2 and calls[1] - calls[0] >= 180


def test_cooling_is_faster_moving_than_standing():
    assert tau_s(0) == pytest.approx(600, rel=0.01)
    assert tau_s(22) < tau_s(10) < tau_s(0)
    assert 100 < tau_s(22) < 150


def test_levels():
    assert level(None) is None and level(float("nan")) is None
    assert level(0) == "cool" and level(WARM_K) == "warm" and level(HOT_K) == "hot"


def test_over_a_recorded_drive_in_5_m_rows():
    dist, v, h = [], [], []
    d, hh = 0.0, 1200.0
    for i in range(3000):
        s = hairpins(i * 0.3)
        dist.append(d); v.append(s); h.append(hh)
        d += 5.0; hh -= 5.0 * 0.07
    r = over_track(dist, v, h)
    assert r["level"] == "hot" and r["hot_m"] > 0
    assert over_track([0, 5, 10], [10, 10, 10], None) is None
    assert over_track([0, 5, 10], [10, 10, 10], [100, 100, 100])["level"] == "cool"


def sequence():
    rnd = random.Random(7)
    seq = []
    for i in range(900):
        v = hairpins(i) + rnd.gauss(0, 0.3)
        h = 1500 - 0.06 * 15 * i + rnd.gauss(0, 2)
        if 300 <= i < 310:
            h = None
        if 500 <= i < 505:
            v = None
        seq.append((0.5 + (i % 3) * 0.5, v, h))
    seq.append((float("nan"), 10.0, 100.0))
    return seq


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_js_port_runs_the_same_sequence():
    seq = sequence()
    b = BrakeHeat()
    py = [b.step(dt, v, h) for dt, v, h in seq]
    script = (
        "const B=require(process.argv[1]);const s=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        "const b=B.create();const out=s.map(([dt,v,h])=>b.step(dt===null?NaN:dt,v,h));"
        "const r=B.overTrack(s.map((_,i)=>i*5),s.map(x=>x[1]),s.map(x=>x[2]));"
        "process.stdout.write(JSON.stringify({out,r}));"
    )
    data = json.dumps([[None if isinstance(dt, float) and math.isnan(dt) else dt, v, h] for dt, v, h in seq])
    res = subprocess.run([NODE, "-e", script, os.path.join(ROOT, "web", "brake_heat.js")], input=data,
                         capture_output=True, text=True, check=True)
    js = json.loads(res.stdout)
    assert len(js["out"]) == len(py)
    for a, b2 in zip(py, js["out"]):
        assert a["level"] == b2["level"] and a["call"] == b2["call"]
        for k in ("rise_k", "power_wkg"):
            if a[k] is None:
                assert b2[k] is None
            else:
                assert b2[k] == pytest.approx(a[k], rel=1e-9, abs=1e-9)
    r = over_track([i * 5 for i in range(len(seq))], [x[1] for x in seq], [x[2] for x in seq])
    assert js["r"]["level"] == r["level"]
    assert js["r"]["peak_k"] == pytest.approx(r["peak_k"], rel=1e-9)
    assert js["r"]["hot_m"] == pytest.approx(r["hot_m"], rel=1e-9)


def test_the_driver_hears_words_never_degrees():
    src = open(os.path.join(ROOT, "web", "brake_heat.js"), encoding="utf-8").read()
    text = re.search(r"CALL_TEXT = '([^']+)'", src).group(1)
    assert not re.search(r"\d|°|degree|celsius|fahrenheit", text, re.I)
    assert text.endswith(".")


def test_the_cockpit_feeds_every_live_frame_and_resets_per_drive():
    page = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert '<script src="brake_heat.js" defer></script>' in page
    src = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert src.count("noteBrakes(fr);") + src.count("noteBrakes(frame);") == 2     # the web sensors and the app's own
    assert "drive.brakes = null; breakSay = null;" in src


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_drive_page_says_it_in_words_only_when_warm_or_hot():
    script = (
        "const B=require(process.argv[1]);const f=(m)=>Math.round(m)+' m';"
        "process.stdout.write(JSON.stringify([B.driveText(null,f),B.driveText({level:'cool',hot_m:0},f),"
        "B.driveText({level:'warm',hot_m:0},f),B.driveText({level:'hot',hot_m:800},f),B.driveText({level:'hot',hot_m:20},f)]));"
    )
    res = subprocess.run([NODE, "-e", script, os.path.join(ROOT, "web", "brake_heat.js")], capture_output=True, text=True, check=True)
    none, cool, warm, hot, short = json.loads(res.stdout)
    assert none is None and cool is None
    assert "estimate" in warm and "estimate" in hot
    assert "about 800 m" in hot and "lower gear" in hot and "about" not in short.split("hot")[1][:8]
    for t in (warm, hot, short):
        assert not re.search(r"°|degree|celsius|fahrenheit", t, re.I)
    view = open(os.path.join(ROOT, "web", "drive_view.js"), encoding="utf-8").read()
    assert "BH.driveText(BH.overTrack(d.dist, d.speed_mps, d.elev)" in view
    assert '<script src="brake_heat.js"></script>' in open(os.path.join(ROOT, "web", "analysis.html"), encoding="utf-8").read()


def truth(seconds, grade, hz):
    """The hairpin descent as the phone sees it: speed from a GPS fix once a second, held between fixes (the app's
    10 Hz frames), height following the road. Returns [(dt, v, h)] at `hz` frames a second."""
    out = []
    for k in range(int(seconds * hz)):
        t = k / hz
        fix = math.floor(t)                              # the last fix's speed is what the frame carries
        out.append((1.0 / hz, hairpins(fix), 1000 - grade * 15 * t))
    return out


def peak_and_calls(seq):
    b = BrakeHeat()
    out = [b.step(dt, v, h) for dt, v, h in seq]
    return b.peak, sum(o["call"] for o in out)


def test_ten_frames_a_second_with_held_speed_read_like_one_a_second():
    p1, c1 = peak_and_calls(truth(480, 0.07, 1))
    p10, c10 = peak_and_calls(truth(480, 0.07, 10))
    assert c1 == 1 and c10 == 1                          # the hot call is not lost at the app's frame rate
    assert p10 == pytest.approx(p1, rel=0.08)


def test_held_speed_does_not_turn_coasting_into_braking():
    """Lift off from 30 to 25 m/s on drag alone and back up, on the flat: no brake work at any frame rate."""
    def coast(hz):
        seq = []
        for k in range(600 * hz):
            fix = k // hz
            c = fix % 30
            v = 30 - 5 * c / 15 if c < 15 else 25 + 5 * (c - 15) / 15
            seq.append((1.0 / hz, v, 100.0))
        return seq
    p1, _ = peak_and_calls(coast(1))
    p10, _ = peak_and_calls(coast(10))
    assert p1 < 20 and p10 < 20


def test_a_drive_recorded_with_held_speed_reads_like_one_with_smooth_speed():
    """The app's CSV holds a fix's speed over its 5 m rows; the web Recorder interpolates. Same drive, same answer."""
    dist, held, smooth, h = [], [], [], []
    t, d = 0.0, 0.0
    while t < 480:
        v = hairpins(t)
        dist.append(d); smooth.append(v); held.append(hairpins(math.floor(t))); h.append(1000 - 0.09 * 15 * t)
        d += 5.0; t += 5.0 / v
    a, b = over_track(dist, smooth, h), over_track(dist, held, h)
    assert a["level"] == b["level"] == "hot"
    assert b["peak_k"] == pytest.approx(a["peak_k"], rel=0.1)
