"""Your year's cleanest corners (core/driver_profile.py best_corners, web/driver_profile.js bestCorners, the words in
web/year_review.js): only that year's dated drives, only corners with all six technique credits, one a drive and one a
road, a tighter corner first on a tie; the port picks the same; the words never give a speed or a time.
"""
import json
import os
import shutil
import subprocess

import pytest

from core import driver_profile as dp
from tests.test_driver_profile import make_drive

NODE = shutil.which("node")


def corner(apex, level, size="medium", way="L", **gaps):
    o = {"apex": apex, "dir": way, "size": size, "use": 0.9, "pace": 1.0}
    for k in dp.SKILLS:
        o[k] = level / 100.0
    o.update(gaps)
    return o


def test_picks_the_cleanest_corner_of_each_road():
    drives = [
        {"id": "a", "at": "2026-05-02T09:00", "name": "Dry Ridge Rd", "obs": [corner(10, 90), corner(50, 97, "tight", "R"), corner(90, 97, "fast")]},
        {"id": "b", "at": "2026-06-02T09:00", "name": "Dry Ridge Rd", "obs": [corner(10, 99)]},     # same road: its better corner wins it
        {"id": "c", "at": "2026-07-02T09:00", "name": "Pebble Ridge", "obs": [corner(10, 95), corner(20, 100, brake=None)]},
        {"id": "d", "at": "2025-12-30T09:00", "name": "Last Year Rd", "obs": [corner(10, 100)]},     # another year
        {"id": "e", "at": None, "name": "Undated", "obs": [corner(10, 100)]},                    # no known date
        {"id": "f", "at": "2026-08-02T09:00", "name": "Hill Rd", "obs": [corner(10, 93)]},
        {"id": "g", "at": "2026-09-02T09:00", "name": "Low Rd", "obs": [corner(10, 80)]},
    ]
    b = dp.best_corners(drives, 2026)
    assert [(x["id"], x["level"]) for x in b] == [("b", 99), ("c", 95), ("f", 93)]
    assert b[1]["apex"] == 10                          # the 100 there has a credit unmeasured: not read
    # a tie goes to the tighter corner, then the earlier one
    tie = dp.best_corners(drives[:1], 2026)
    assert tie[0]["size"] == "tight" and tie[0]["dir"] == "R" and tie[0]["apex"] == 50
    assert dp.best_corners(drives, 2024) == [] and dp.best_corners([], 2026) == []


def test_from_real_observations():
    obs = dp.observe(make_drive(3))
    b = dp.best_corners([{"id": "x", "at": "2026-10-01T08:00", "name": "Test Rd", "obs": obs}], 2026)
    assert len(b) == 1 and 0 <= b[0]["level"] <= 100 and b[0]["size"] in ("tight", "medium", "fast")


def test_records_by_size_hold_the_first_cleanest_corner():
    t = [corner(10 * i, 80 + i, "tight") for i in range(4)]
    drives = [
        {"id": "a", "at": "2026-05-02T09:00", "name": "Dry Ridge Rd", "obs": t + [corner(90, 95, "medium", "R")]},
        {"id": "b", "at": "2026-03-02T09:00", "name": "Pebble Ridge", "obs": [corner(5, 95, "medium"), corner(7, 99, "tight", brake=None)]},
        {"id": "c", "at": None, "name": "Undated", "obs": [corner(5, 97, "tight")] + [corner(20 + i, 70, "medium") for i in range(3)]},
        {"id": "d", "at": "2025-12-30T09:00", "name": "Last Year Rd", "obs": [corner(5, 60, "fast")]},
    ]
    r = dp.records_by_size(drives)
    assert r["tight"]["id"] == "c" and r["tight"]["level"] == 97 and r["tight"]["at"] is None and r["tight"]["n"] == 5   # unmeasured credit: not read
    assert (r["medium"]["id"], r["medium"]["level"], r["medium"]["n"]) == ("b", 95, 5)       # a tie: the earlier drive holds it
    assert r["fast"] is None                                                                  # one fast corner says nothing
    assert dp.records_by_size([]) == {"tight": None, "medium": None, "fast": None}


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_parity_and_words():
    drives = [{"id": f"d{s}", "at": f"2026-{4 + s:02d}-0{1 + s}T09:00", "name": f"Road {s % 3}", "obs": dp.observe(make_drive(s, fault=(lambda i, w, z: "saw" if i % 4 == s % 4 else None)))} for s in range(6)]
    py = dp.best_corners(drives, 2026)
    rec = dp.records_by_size(drives + [{"id": "u", "at": None, "name": None, "obs": dp.observe(make_drive(7))}])
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js'),Y=require(process.argv[1]+'/web/year_review.js');"
              "const [ds,more]=JSON.parse(require('fs').readFileSync(0,'utf8'));const b=P.bestCorners(ds,2026);"
              "process.stdout.write(JSON.stringify({b,rec:P.recordsBySize(ds.concat(more)),say:Y.lines({miles:1,m:1609.344,drives:1,corners:3,months:1,topRoads:[],best:null,longest:null,bestCorners:b}),"
              "one:Y.cornerText({at:'2026-08-12T09:00',name:'Dry Ridge Rd',dir:'R',size:'tight',level:99}),"
              "bare:Y.cornerText({at:null,name:null,dir:null,size:null,level:90})}));")
    out = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([drives, [{"id": "u", "at": None, "name": None, "obs": dp.observe(make_drive(7))}]]), capture_output=True, text=True, check=True).stdout)
    assert out["b"] == py and len(py) == 3
    assert out["rec"] == rec and sum(rec[z] is not None for z in rec) >= 2
    assert out["one"] == "a tight right on Dry Ridge Rd (Aug 12), 99"
    assert out["bare"] == "a corner, 90"
    line = out["say"][-1]
    assert line.startswith("Cleanest corners: a ") and line.count(";") == 2
    assert not any(w in line for w in ("mph", "km/h", " s,", "fast as"))


def test_a_drive_against_your_records():
    mine = [corner(5, 90, "tight"), corner(9, 94, "tight", "R"), corner(20, 99, "medium"), corner(30, 70, "fast", brake=None)]
    rec = {"tight": {"id": "x", "at": "2026-08-12T09:00", "name": "Dry Ridge Rd", "apex": 3, "dir": "L", "level": 100, "n": 12},
           "medium": {"id": "me", "at": "2026-09-01T09:00", "name": "Hill Rd", "apex": 20, "dir": "L", "level": 99, "n": 8}, "fast": None}
    dr = dp.drive_records(mine, rec)
    assert dr["tight"]["level"] == 94 and dr["tight"]["record"]["level"] == 100
    assert dr["medium"]["level"] == 99 and dr["fast"]["level"] is None                  # an unmeasured credit: no fast corner read
    assert dp.drive_records([], {}) == {z: {"level": None, "record": None} for z in ("tight", "medium", "fast")}
    if NODE is None:
        return
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const [o,r]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const dr=P.driveRecords(o,r);process.stdout.write(JSON.stringify({dr,say:P.driveRecordLines(dr,'me'),"
              "alone:P.driveRecordLines(P.driveRecords(o,{}),'me'),none:P.driveRecordLines(null,'me')}));")
    out = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([mine, rec]), capture_output=True, text=True, check=True).stdout)
    assert out["dr"] == dr
    assert out["say"] == ["Tight corners: 94 at best here; your record is 100 (2026-08-12).",
                          "Medium corners: 99 at best here, your record of 8 medium corners."]
    level = subprocess.run([NODE, "-e", "const P=require(process.argv[1]+'/web/driver_profile.js');process.stdout.write(P.driveRecordLines({tight:{level:100,record:{id:'x',at:'2026-05-01T09:00',level:100,n:9}}},'me')[0])", os.getcwd()],
                           capture_output=True, text=True, check=True).stdout
    assert level == "Tight corners: 100 at best here, level with your record (2026-05-01)."
    assert out["alone"] == ["Tight corners: 94 at best here.", "Medium corners: 99 at best here."] and out["none"] == []
    words = " ".join(out["say"]).lower()
    assert not any(w in words for w in ("mph", "km/h", "better", "worse", "faster", "push"))


def test_road_records_corner_by_corner():
    c = lambda x, lv, hx=1.0: {"apex": int(x // 5), "x": x, "y": 0.0, "hx": hx, "hy": 0.0, "level": lv}
    mine = [c(0, 95), c(300, 80), c(600, 90), c(900, 99)]
    others = [[c(5, 90), c(305, 85), c(603, 90), c(1500, 100)],          # 5 m off: the same corners
              [c(-8, 93), c(310, 70), c(598, 88, hx=-1.0)]]                # the third the other way: not the same corner
    r = dp.road_records(mine, others)
    rows = [{"apex": 0, "level": 95, "passes": 3, "record": 95, "low": 90, "by": None}, {"apex": 60, "level": 80, "passes": 3, "record": 85, "low": 70, "by": 0}]
    # 300 m spans 70 to 85: uneven, and this drive's 80 is within 5 of the 85
    assert r == {"corners": 2, "best": 1, "level": 0, "held": [0], "rows": rows, "uneven": 1, "steady": 1}   # 0 m: best of three; 300 m: 85 beat it; 600, 900: too few
    assert dp.road_records(mine, others, ["a", "b"])["rows"][1]["by"] == "a"   # the other drive by its id
    assert dp.road_records(mine, []) == {"corners": 0, "best": 0, "level": 0, "held": [], "rows": [], "uneven": 0, "steady": 0}
    tie = dp.road_records([c(0, 90)], [[c(1, 90)], [c(2, 80)]])
    assert tie == {"corners": 1, "best": 0, "level": 1, "held": [], "rows": [{"apex": 0, "level": 90, "passes": 3, "record": 90, "low": 80, "by": 0}], "uneven": 0, "steady": 0}
    low = dp.road_records([c(0, 60)], [[c(1, 90)], [c(2, 80)]])
    assert (low["uneven"], low["steady"]) == (1, 0)                      # 60 to 90, and this drive the 60
    first = dp.road_records([c(0, 80)], [[c(1, 90)], [c(2, 90)]], ["old", "new"])["rows"][0]
    assert first["by"] == "old"                                          # of equals the first listed (the oldest) holds it
    if NODE is None:
        return
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const [m,o]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const r=P.roadRecords(m,o),ids=P.roadRecords(m,o,['a','b']).rows[1].by,day=(x)=>x.by==='a'?'Aug 12':null;"
              "const un=[{uneven:3,steady:2},{uneven:1,steady:1},{uneven:3,steady:3},{uneven:1,steady:0},{uneven:2,steady:0},{uneven:0,steady:0},null].map(P.roadUnevenLine);"
              "const notes=[{by:null,passes:4,record:92,level:92},{by:'a',passes:3,record:90,level:90},{by:'a',passes:3,record:90,level:82},{by:'b',passes:3,record:90,level:82},null].map((x)=>P.roadCornerNote(x,day));"
              "process.stdout.write(JSON.stringify({r,ids,notes,un,say:[P.roadRecordLine(r),P.roadRecordLine({corners:24,best:7,level:2}),"
              "P.roadRecordLine({corners:1,best:0,level:0}),P.roadRecordLine({corners:0,best:0,level:0}),P.roadRecordLine(null),P.roadRecordLine({corners:24,best:0,level:24})]}));")
    out = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([mine, others]), capture_output=True, text=True, check=True).stdout)
    assert out["r"] == r and out["ids"] == "a"
    assert out["un"] == ["At the 3 corners here where your passes differ most, this drive was near your cleanest at 2.",
                         "At the corner here where your passes differ most, this drive was near your cleanest there.",
                         "At the 3 corners here where your passes differ most, this drive was near your cleanest at every one.",
                         "At the corner here where your passes differ most, this drive was not near your cleanest: it is the place to work on.",
                         "At the 2 corners here where your passes differ most, this drive was not near your cleanest at any of them: they are the places to work on.",
                         None, None]
    assert out["notes"] == ["Your cleanest of 4 passes here (92)", "Level with your cleanest here (90, Aug 12)",
                            "Your cleanest here: 90, Aug 12; this pass 82", "Your cleanest here: 90; this pass 82", None]
    assert out["say"] == ["On this road: your cleanest pass yet at 1 of the 2 corners here you have driven three or more times.",
                          "On this road: your cleanest pass yet at 7 of the 24 corners here you have driven three or more times, level with it at 2.",
                          "On this road: 1 corner you have driven three or more times; your cleanest pass of it came on another drive.",
                          None, None,
                          "On this road: level with your cleanest pass at 24 of the 24 corners here you have driven three or more times."]


def test_road_book_every_corner_of_a_road():
    c = lambda x, lv, hx=1.0, size="tight": {"x": x, "y": 0.0, "hx": hx, "hy": 0.0, "level": lv, "size": size, "dir": "L"}
    drives = [{"id": "a", "at": "2026-05-01T09:00", "corners": [c(600, 90), c(0, 80), c(300, 70, size="fast")]},
              {"id": "b", "at": "2026-06-01T09:00", "corners": [c(4, 92), c(305, 70), c(603, 90), c(900, 99)]},
              {"id": "c", "at": "2026-07-01T09:00", "corners": [c(-6, 85), c(298, 75), c(598, 88, hx=-1.0), c(1, 91)]},
              {"id": "d", "at": None, "corners": [c(602, 60), c(1200, None)]}]
    ref = [[x, 0.0] for x in range(0, 1001, 50)]
    b = dp.road_book(drives, ref)
    # 0 m: a 80, b 92, c 91 (its cleanest of two) -> b; 300 m: 70, 70, 75 -> c; 600 m: a 90, b 90, d 60 -> a (the older of
    # equals); 600 m the other way (c) and 900 m (b) passed once
    assert [(k["x"], k["passes"], k["record"], k["by"], k["at"], k["size"]) for k in b["corners"]] == [
        (0, 3, 92, "b", "2026-06-01T09:00", "tight"), (300, 3, 75, "c", "2026-07-01T09:00", "fast"), (600, 3, 90, "a", "2026-05-01T09:00", "tight")]
    assert b["fewer"] == 2 and b["drives"] == 4
    assert [k["low"] for k in b["corners"]] == [80, 70, 60] and b["uneven"] == [3]     # 600 m: 90 down to 60; 0 m spans 12 only
    assert [k["x"] for k in dp.road_book(drives)["corners"]] == [600, 0, 300]          # with no ref: as first seen
    assert dp.road_book([]) == {"corners": [], "fewer": 0, "drives": 0, "uneven": []}
    if NODE is None:
        return
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const [d,r]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const b=P.roadBook(d,r),w=P.roadBookRows(b,(at)=>at.slice(5,10)),two=P.roadBookRows({...b,uneven:[3,1]},null);"
              "process.stdout.write(JSON.stringify([[b,P.roadBook(d),P.roadBook([])],w,two.work,P.roadBookRows(P.roadBook([]),null)]));")
    out = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([drives, ref]), capture_output=True, text=True, check=True).stdout)
    assert out[0] == json.loads(json.dumps([b, dp.road_book(drives), dp.road_book([])]))
    w = out[1]
    assert w["head"] == "3 corners you have driven three or more times, in road order; 2 more fewer times. Each with your cleanest pass and the drive it came on."
    assert w["work"] == "Least even: corner 3, where your passes differ the most."
    assert [(r["n"], r["what"], r["record"], r["low"], r["uneven"], r["by"], r["on"], r["passes"]) for r in w["rows"]] == [
        (1, "Tight left", 92, 80, False, "b", "06-01", 3), (2, "Fast left", 75, 70, False, "c", "07-01", 3), (3, "Tight left", 90, 60, True, "a", "05-01", 3)]
    assert out[2] == "Least even: corners 3 and 1, where your passes differ the most." and out[3] is None
