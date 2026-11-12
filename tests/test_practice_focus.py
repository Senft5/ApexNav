"""Practice (IDEAS D-27; core/driver_profile.py practice and drive_practice, web/driver_profile.js): the skill "Work on"
names is carried into the next drives, each read on that skill alone against every corner before the plan began. A
driver who stops sawing at the wheel must read as up, one who keeps sawing as no change, one with too few corners must
be told so, and the JS port must agree with the Python and word it as the end card says it.
"""
import json
import os
import shutil
import subprocess

import pytest

from core import driver_profile as dp
from tests.test_driver_profile import make_drive

NODE = shutil.which("node")
SAW_R = lambda i, way, size: "saw" if way == "R" else None
PLAN = {"skill": "arc", "since": "2026-11-05T09:00", "where": {"split": "dir", "a": "L", "b": "R", "worse": "R"}}


def drives(after_fault, n_before=5, n_after=3, corners=30):
    out = []
    for s in range(n_before):
        out.append({"id": f"b{s}", "at": f"2026-10-{10 + s:02d}T08:00", "obs": dp.observe(make_drive(s, corners=corners, fault=SAW_R))})
    for s in range(n_after):
        out.append({"id": f"a{s}", "at": f"2026-11-{6 + s:02d}T08:00", "obs": dp.observe(make_drive(100 + s, corners=corners, fault=after_fault))})
    return out


def test_practice_that_works_reads_as_up_drive_by_drive():
    pr = dp.practice(drives(None), PLAN)
    assert pr["skill"] == "arc" and pr["before"]["n"] == 150 and pr["after"]["n"] == 90
    assert pr["before"]["level"] <= 80 and pr["after"]["level"] >= 93
    assert pr["sure"] and pr["delta"] == pr["after"]["level"] - pr["before"]["level"]
    assert [d["id"] for d in pr["drives"]] == ["a0", "a1", "a2"]
    for d in pr["drives"]:
        assert d["n"] == 30 and d["sure"] and d["delta"] > 10
        assert d["where_n"] == 15 and d["where_level"] >= 90           # rights, where it showed most, are fixed too


def test_practice_that_changes_nothing_says_no_change():
    pr = dp.practice(drives(SAW_R), PLAN)
    assert not pr["sure"] and abs(pr["delta"]) <= 4
    assert not any(d["sure"] for d in pr["drives"])
    assert all(d["where_level"] <= 70 for d in pr["drives"])          # rights still sawn


def test_too_few_corners_and_unknowns_stay_unknown():
    few = drives(None, n_after=1, corners=3)
    pr = dp.practice(few, PLAN)
    d = pr["drives"][0]
    assert d["n"] == 3 and d["level"] is None and d["delta"] is None and not d["sure"]
    assert pr["after"]["level"] is None and pr["delta"] is None
    # nothing before the plan: a level, but nothing to set it against
    pr = dp.practice([x for x in drives(None) if x["id"].startswith("a")], PLAN)
    assert pr["before"] == {"level": None, "n": 0, "mean": None, "se": None}
    assert pr["after"]["level"] >= 93 and pr["delta"] is None and not pr["sure"]
    # a drive of unknown date counts before; a skill that isn't one is no plan
    undated = drives(None)
    undated[-1] = {**undated[-1], "at": None}
    assert dp.practice(undated, PLAN)["before"]["n"] == 180
    assert dp.practice(drives(None), {"skill": "speed"}) is None and dp.drive_practice([], None) is None
    # a place that is only "the rest" or a whole-drive one reads no corners of its own
    r = dp.drive_practice(drives(None)[-1]["obs"], {**PLAN, "where": {"split": "size", "a": "tight", "b": "rest", "worse": "rest"}})
    assert r["where_n"] is None and r["where_level"] is None


def test_the_end_card_agrees_with_the_page():
    # the end card reads one drive against the level the plan kept (rounded, as stored); the page reads the same drive
    ds = drives(None)
    pr = dp.practice(ds, PLAN)
    one = dp.drive_practice(ds[-1]["obs"], PLAN, (pr["before"]["mean"], pr["before"]["se"]))
    assert {k: one[k] for k in one} == {k: v for k, v in pr["drives"][-1].items() if k not in ("id", "at")}


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_parity_and_the_words():
    cases = [drives(None), drives(SAW_R), drives(None, n_after=1, corners=3), [x for x in drives(None) if x["id"].startswith("a")]]
    py = [dp.practice(c, PLAN) for c in cases]
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const [cases,plan]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const pr=cases.map((c)=>P.practice(c,plan));"
              "const kept=(x)=>({...plan,before:x.before});"
              "const lines=pr.map((x)=>x.drives.map((d)=>P.practiceLine(d,kept(x))));"
              "const sums=pr.map(P.practiceSummary);"
              "const zero=P.practiceLine({skill:'exit',n:0,level:null,delta:null,sure:false,where_n:null,where_level:null},null);"
              "const p=P.profile(cases[1].map((d)=>({...d,month:d.at.slice(0,7)})));"
              "process.stdout.write(JSON.stringify({pr,lines,sums,zero,card:P.cardLine(p,pr[0]),cardWait:P.cardLine(p,pr[2]),stamp:P.localStamp(new Date(2026,10,5,9,7))}));")
    out = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([cases, PLAN]), capture_output=True, text=True, check=True).stdout)

    def same(x, y, at=""):
        if isinstance(y, dict):
            assert isinstance(x, dict) and set(x) == set(y), at
            for k in y:
                same(x[k], y[k], f"{at}.{k}")
        elif isinstance(y, list):
            assert isinstance(x, list) and len(x) == len(y), at
            for i, (p, q) in enumerate(zip(x, y)):
                same(p, q, f"{at}[{i}]")
        elif isinstance(y, float):
            assert x == pytest.approx(y, abs=1e-9), at
        else:
            assert x == y, at
    same(out["pr"], py)

    up, flat, few, fresh = out["lines"]
    b, a = py[0]["before"]["level"], py[0]["drives"][0]
    assert up[0] == f"Practice · One steering arc: {a['level']} on 30 corners, {a['delta']} above your {b} before. Through rights: {a['where_level']} on 15."
    assert flat[0].startswith("Practice · One steering arc: ") and f", close to your {b} before." in flat[0]
    assert few == ["Practice · One steering arc: 3 corners to judge it on, too few to say."]
    assert fresh[0] == f"Practice · One steering arc: {py[3]['drives'][0]['level']} on 30 corners. Through rights: {py[3]['drives'][0]['where_level']} on 15."
    assert out["zero"] == "Practice · Back to power: no corner on this drive to judge it on."
    s_up, s_flat, s_few, s_fresh = out["sums"]
    assert s_up == f"Since 5 Nov: {py[0]['after']['level']} on 90 corners over 3 drives, against {b} on 150 before. Up {py[0]['delta']} points: the practice is showing."
    assert s_flat.endswith("No clear change yet: a change is said once it is well beyond chance.")
    assert s_few == "Since 5 Nov: no drive yet with 4 or more corners."
    assert s_fresh.endswith("There were too few corners before to compare with.")
    assert out["card"].endswith(f"Practicing: One steering arc {py[0]['after']['level']}, {b} before")
    assert out["cardWait"].endswith("Practicing: One steering arc from your next drive")
    assert out["stamp"] == "2026-11-05T09:07"
    text = " ".join(up + flat + few + [s_up, s_flat, out["card"]])
    assert not any(w in text.lower() for w in ("faster", "quicker", "mph", "km/h", "seconds"))   # technique, never pace


ROAD = {"skill": "arc", "since": "2026-11-05T09:00", "where": {"road": "dry ridge rd", "name": "Dry Ridge Rd"}}


def named(ds, road_ids):
    return [{**d, "name": "Dry Ridge Rd " if d["id"] in road_ids else "Bell Gap"} for d in ds]


def test_a_per_road_practice_reads_that_road_alone():
    # practice from a road's book: only that road's drives count, before and after; elsewhere is not the practice
    ds = named(drives(None), {"b0", "b1", "b2", "b3", "a1"})
    pr = dp.practice(ds, ROAD)
    assert pr["road"] == "Dry Ridge Rd" and pr["before"]["n"] == 120 and pr["after"]["n"] == 30
    assert [d["id"] for d in pr["drives"]] == ["a1"] and pr["sure"]
    assert all(d["where_n"] is None for d in pr["drives"])           # a road is not a side of the corner
    assert dp.practice(ds, PLAN)["road"] is None and dp.practice(ds, PLAN)["after"]["n"] == 90
    assert dp.on_plan_road(ROAD, "  DRY RIDGE RD") and not dp.on_plan_road(ROAD, "Bell Gap") and not dp.on_plan_road(ROAD, None)
    assert dp.on_plan_road(PLAN, "Bell Gap") and dp.on_plan_road(None, None)
    # no drive on the road yet since the plan
    assert dp.practice(named(drives(None), {"b0", "b1"}), ROAD)["after"] == {"level": None, "n": 0}


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_a_per_road_practice_parity_and_words():
    cases = [named(drives(None), {"b0", "b1", "b2", "b3", "a1"}), named(drives(None), {"b0", "b1"})]
    py = [dp.practice(c, ROAD) for c in cases]
    names = ["Dry Ridge Rd", "dry ridge rd ", "Bell Gap", None]
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const [cases,plan,names]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const pr=cases.map((c)=>P.practice(c,plan));"
              "const line=P.practiceLine(pr[0].drives[0],{...plan,before:pr[0].before});"
              "process.stdout.write(JSON.stringify({pr,sums:pr.map(P.practiceSummary),on:names.map((n)=>P.onPlanRoad(plan,n)),line}));")
    out = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([cases, ROAD, names]), capture_output=True, text=True, check=True).stdout)
    assert json.dumps(out["pr"], sort_keys=True) == json.dumps(py, sort_keys=True)
    assert out["on"] == [dp.on_plan_road(ROAD, n) for n in names] == [True, True, False, False]
    up, none = out["sums"]
    assert up.startswith(f"Since 5 Nov on Dry Ridge Rd: {py[0]['after']['level']} on 30 corners over 1 drive, against ")
    assert none == "Since 5 Nov on Dry Ridge Rd: no drive there yet with 4 or more corners."
    d = py[0]["drives"][0]
    assert out["line"] == f"Practice on Dry Ridge Rd · One steering arc: {d['level']} on 30 corners, {d['delta']} above your {py[0]['before']['level']} before."


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_scope_line_and_definition():
    ds = [{**d, "month": d["at"][:7]} for d in drives(None)]
    p = dp.profile(ds)
    assert p["span"] == ["2026-10", "2026-11"] and dp.profile([])["span"] is None
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const p=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify([P.scopeLine(p),P.scopeLine({...p,span:['2026-11','2026-11']}),P.scopeLine({...p,span:['2025-12','2026-02']}),"
              "P.scopeLine({...p,span:null}),P.skillDef('arc',{n:1}),P.skillDef('brake',{n:40})]));")
    out = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps(p), capture_output=True, text=True, check=True).stdout)
    assert out[:4] == ["240 clean corners · 8 drives · Oct–Nov 2026", "240 clean corners · 8 drives · Nov 2026",
                       "240 clean corners · 8 drives · Dec 2025–Feb 2026", "240 clean corners · 8 drives"]
    assert out[4].endswith(" 0 to 100, averaged over 1 clean corner; -- until 30.") and out[5].endswith("averaged over 40 clean corners; -- until 30.")
