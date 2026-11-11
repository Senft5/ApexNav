"""Touch in more detail (core/driver_profile.py, web/driver_profile.js): by size of corner, month by month, and one drive's
own touch beside the usual for its Log page. Planted rates are read back in each cell; too few corners stay unknown; the
port says the same numbers, and its words state rates without ever calling a drive better or worse.
"""
import json
import os
import shutil
import subprocess

import pytest

from core import driver_profile as dp
from tests.test_driver_profile import entry, make_drive
from tests.test_touch import plant

NODE = shutil.which("node")


def test_touch_by_size_reads_each_size():
    p = dp.profile([entry(plant(make_drive(s), 0.8, 0.5, 0.6, seed=s), s) for s in range(3)])
    for z in ("tight", "medium", "fast"):
        t = p["touch_by"][z]
        assert t["brake_on"]["n"] >= dp.MATRIX_MIN, z
        assert t["brake_on"]["rate"] == pytest.approx(0.8, rel=0.2), (z, t)
        assert t["turn_in"]["rate"] == pytest.approx(0.6, rel=0.2), (z, t)
    # a size with too few corners has no rate
    few = dp.profile([entry(plant(make_drive(0, corners=6), seed=0), 0)])["touch_by"]
    assert all(few[z][k]["rate"] is None for z in few for k in dp.TOUCH)


def test_touch_trend_by_month():
    drives = [entry(plant(make_drive(s), on, 0.5, 0.6, seed=s), s, month=m)
              for s, (m, on) in enumerate((("2026-08", 0.3), ("2026-09", 0.5), ("2026-10", 0.7)))]
    tt = dp.profile(drives)["touch_trend"]
    assert [x["month"] for x in tt["brake_on"]] == ["2026-08", "2026-09", "2026-10"]
    rates = [x["rate"] for x in tt["brake_on"]]
    assert rates[0] == pytest.approx(0.3, rel=0.2) and rates[2] == pytest.approx(0.7, rel=0.2) and rates[0] < rates[1] < rates[2]
    assert all(x["n"] >= dp.TREND_MIN for x in tt["brake_on"])
    # a month with too few corners is left out, never a guess
    short = dp.profile([entry(plant(make_drive(0, corners=8), seed=0), 0, month="2026-07")] + drives)["touch_trend"]
    assert short["brake_on"][0]["month"] == "2026-08"


def test_a_drive_beside_the_usual():
    mine = dp.observe(plant(make_drive(7), 0.7, 0.5, 0.6, seed=7))
    others = [o for s in range(3) for o in dp.observe(plant(make_drive(s), 0.35, 0.5, 0.6, seed=s))]
    dt = dp.drive_touch(mine, others)
    assert dt["drive"]["brake_on"]["rate"] == pytest.approx(0.7, rel=0.2)
    assert dt["usual"]["brake_on"]["rate"] == pytest.approx(0.35, rel=0.2)
    # a short drive says nothing of its own; with no other drive there is no usual
    assert all(dp.drive_touch(mine[:dp.DRIVE_TOUCH_MIN - 1], others)["drive"][k]["rate"] is None for k in dp.TOUCH)
    assert all(dp.drive_touch(mine, [])["usual"][k]["rate"] is None for k in dp.TOUCH)


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_parity_and_words():
    drives = [plant(make_drive(s), 0.5 + 0.3 * s, 0.4 + 0.2 * s, 0.5, seed=s) for s in range(3)] + [make_drive(9)]
    meta = [{"id": f"d{i}", "month": f"2026-{8 + i:02d}", "car": None, "tags": None} for i in range(len(drives))]
    py_obs = [dp.observe(d) for d in drives]
    py = dp.profile([{**m, "obs": o} for m, o in zip(meta, py_obs)])
    py_dt = dp.drive_touch(py_obs[0], [o for x in py_obs[1:] for o in x])
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const [ds,meta]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const obs=ds.map((d)=>P.observe(d));const p=P.profile(meta.map((m,i)=>({...m,obs:obs[i]})));"
              "const dt=P.driveTouch(obs[0],obs.slice(1).flat());"
              "process.stdout.write(JSON.stringify({by:p.touch_by,tt:p.touch_trend,dt,trend:P.touchTrendLines(p.touch_trend),say:P.driveTouchLines(dt),"
              "fixed:P.driveTouchLines({drive:{brake_on:{rate:1.42},brake_off:{rate:null,quick_rate:true},turn_in:{rate:null}},usual:{brake_on:{rate:0.86},brake_off:{rate:0.5},turn_in:{rate:0.7}}}),"
              "alone:P.driveTouchLines({drive:{brake_on:{rate:0.9},brake_off:{rate:null},turn_in:{rate:null}},usual:{brake_on:{rate:null},brake_off:{rate:null},turn_in:{rate:null}}}),"
              "months:P.touchTrendLines({brake_on:[{month:'2026-09',rate:1.2,quick:false},{month:'2026-10',rate:null,quick:true}],brake_off:[{month:'2026-09',rate:0.5}],turn_in:[]}),"
              "none:P.driveTouchLines(null)}));")
    out = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([drives, meta]), capture_output=True, text=True, check=True).stdout)
    assert out["by"] == py["touch_by"]
    assert out["tt"] == py["touch_trend"]
    assert out["dt"] == py_dt
    assert out["fixed"] == ["Brakes on: about 1.4 g a second on this drive, 0.86 usually.",
                            "Brakes off: one quick movement (quicker than the recording can time) on this drive, 0.5 usually."]
    assert out["alone"] == ["Brakes on: about 0.9 g a second on this drive."]
    assert out["months"] == ["Brakes on month by month, in g a second: Sep 1.2, Oct quick."]
    assert out["none"] == [] and out["say"] and len(out["trend"]) >= 1
    words = " ".join(out["say"] + out["trend"] + out["fixed"]).lower()
    assert not any(w in words for w in ("better", "worse", "faster", "push", "work on"))
