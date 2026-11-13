"""Pace in Your driving (IDEAS D-29): the Vetta Score's own pace credit per corner, read beside the six technique skills:
a level, by kind of corner, by month, where it is measurably lower or higher, and how often a corner went over its sane
limit. It is never the strongest, never the one to work on and never practised (Vetta does not tell anyone to go faster).
"""
import json
import os
import shutil
import subprocess

import pytest

from core import driver_profile as dp
from core import drive_analysis as da
from tests.test_driver_profile import entry, make_drive

NODE = shutil.which("node")


def scaled(drive, f):
    """The drive with corner i's sane-limit speed scaled by f(i, corner) (more than 1: the same driving uses less of it)."""
    return {**drive, "corners": [{**c, "apex_mps": c["apex_mps"] * f(i, c)} for i, c in enumerate(drive["corners"])]}


def test_pace_is_the_scores_pace_credit():
    obs = dp.observe(make_drive(1))
    assert obs and all(o["pace"] == da._pace_credit(o["use"]) for o in obs)


def test_pace_is_read_but_never_the_one_to_work_on():
    # clean technique, and pace well short of full (the car uses 60 % of each corner's limit): pace is the lowest level
    p = dp.profile([entry(make_drive(s), s) for s in range(4)])
    lv = p["skills"]["pace"]["level"]
    assert lv is not None and lv < min(p["skills"][k]["level"] for k in dp.SKILLS)
    assert p["focus"] is None and p["strongest"] != "pace"
    assert all("pace" in m["levels"] for m in p["matrix"])
    assert dp.drive_practice(entry(make_drive(1), 0)["obs"], {"skill": "pace"}) is None


def test_held_back_downhill_is_a_pace_finding_not_a_technique_one():
    # downhill corners driven at the same speed on roads whose limit is 30 % higher: less of the grip used going down
    down = lambda i: False if i % 4 == 1 else (True if i % 4 == 3 else None)
    ds = [scaled(make_drive(s, corners=60, uphill=down), lambda i, c: 1.3 if i % 4 == 1 else 1.0) for s in range(4)]
    p = dp.profile([entry(d, s) for s, d in enumerate(ds)])
    f = next(f for f in p["pace_findings"] if (f["split"], f["a"]) == ("grade", "down"))
    assert f["skill"] == "pace" and f["mean_a"] < f["mean_b"] and f["also"] == []
    assert all(x["skill"] != "pace" for x in p["findings"])               # said apart from the technique


def test_over_the_limit_is_counted_and_costs_pace():
    over = [scaled(make_drive(s), lambda i, c: 0.5 if i % 5 == 0 else 1.0) for s in range(4)]   # 1 corner in 5 at 120 %
    p = dp.profile([entry(d, s) for s, d in enumerate(over)])
    assert abs(p["pace"]["over"] - 0.2) < 0.01 and p["pace"]["n"] == 120
    clean = dp.profile([entry(make_drive(s), s) for s in range(4)])
    assert clean["pace"]["over"] == 0
    few = dp.profile([entry(make_drive(1, corners=9), 0)])
    assert few["pace"]["over"] is None and few["skills"]["pace"]["level"] is None


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_parity_and_words():
    down = lambda i: False if i % 4 == 1 else (True if i % 4 == 3 else None)
    ds = [scaled(make_drive(s, corners=60, uphill=down), lambda i, c: 1.3 if i % 4 == 1 else (0.5 if i % 7 == 0 else 1.0)) for s in range(4)]
    meta = [{"id": f"d{i}", "month": ("2026-09", "2026-10")[i % 2], "car": None, "tags": None} for i in range(len(ds))]
    py = dp.profile([{**m, "obs": dp.observe(d)} for m, d in zip(meta, ds)])
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const [ds,meta]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const p=P.profile(meta.map((m,i)=>({...m,obs:P.observe(ds[i])})));"
              "process.stdout.write(JSON.stringify({pace:p.pace,lv:p.skills.pace,pf:p.pace_findings,trend:p.trend.pace,lines:P.paceLines(p),find:p.pace_findings.map(P.findingLine),"
              "none:P.paceLines({skills:{pace:{level:80}},pace:{over:0}}),few:P.paceLines({skills:{pace:{level:80}},pace:{over:0.03}}),unk:P.paceLines({skills:{pace:{level:null}},pace:{over:null}})}));")
    js = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([ds, meta]), capture_output=True, text=True, check=True).stdout)
    assert js["pace"] == py["pace"] and js["lv"] == py["skills"]["pace"] and js["trend"] == py["trend"]["pace"]
    assert [(f["split"], f["a"], f["mean_a"], f["mean_b"]) for f in js["pf"]] == [(f["split"], f["a"], f["mean_a"], f["mean_b"]) for f in py["pace_findings"]]
    assert js["lines"][0].startswith("Over the sane limit: 1 of 10 corners.") and "leave more in hand" in js["lines"][0]
    down_line = next(t for t in js["find"] if "downhill" in t)
    assert down_line.startswith("Pace: downhill ")
    assert js["none"] == ["Over the sane limit: no corner"] and js["few"] == ["Over the sane limit: 3 of 100 corners"] and js["unk"] == []
    assert not any(w in " ".join(js["lines"] + js["find"]).lower() for w in ("faster", "quicker", "push", "work on"))
