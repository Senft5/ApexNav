"""Flow (core/flow.py, web/flow.js): the longest run of corners in a row driven smooth and settled."""
import json
import math
import os
import shutil
import subprocess

import pytest

from core import flow
from core import drive_analysis as da

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")
MPH = 2.2369362921


def drive(kinds, gap_bins=60):
    """A synthetic drive: one corner per kind, gap_bins of straight between. kind 'ok' smooth and settled, 'jerky' sawing
    at the wheel, 'late' braking past the apex, 'over' past the sane limit, 'stop' stopped through it."""
    v, lon, lat, corners = [], [], [], []
    for k in kinds:
        v += [20.0] * gap_bins; lon += [0.0] * gap_bins; lat += [0.0] * gap_bins
        s = len(v)
        for q in range(30):
            ramp = math.sin(math.pi * q / 29)
            v.append(2.0 if k == "stop" else 15.0)
            lat.append(0.35 * ramp + (0.12 * (-1) ** q if k == "jerky" else 0.0))
            lon.append(-0.4 if (k == "late" and q > 18) else 0.0)
        corners.append({"start": s, "end": s + 29, "apex": s + 15, "apex_mps": 12.0 if k == "over" else 18.0})
    v += [20.0] * gap_bins; lon += [0.0] * gap_bins; lat += [0.0] * gap_bins
    return v, lon, lat, corners


def test_the_longest_run_of_flowing_corners_is_found():
    v, lon, lat, cs = drive(["ok"] * 3 + ["jerky"] + ["ok"] * 6 + ["late"] + ["ok"] * 5)
    r = flow.longest_flow(v, lon, lat, cs)
    assert r["corners"] == 6
    assert r["start_m"] == cs[4]["start"] * 5 and r["end_m"] == cs[9]["end"] * 5


def test_each_kind_of_fault_breaks_a_run():
    for bad in ("jerky", "late", "over", "stop"):
        v, lon, lat, cs = drive(["ok"] * 4 + [bad] + ["ok"] * 4)
        assert flow.longest_flow(v, lon, lat, cs) is None, bad          # 4 + 4: neither half reaches MIN_RUN
        t = da.corner_technique(v, lon, lat, cs[4])
        assert not flow.in_flow(t), bad


def test_a_long_straight_ends_a_run_and_short_runs_say_nothing():
    v, lon, lat, cs = drive(["ok"] * 8, gap_bins=450)                   # 2.25 km between corners
    assert flow.longest_flow(v, lon, lat, cs) is None
    v, lon, lat, cs = drive(["ok"] * 4)
    assert flow.longest_flow(v, lon, lat, cs) is None
    assert flow.longest_flow([], [], [], []) is None


def _shipped():
    out = []
    for path in ("web/data/pebble_ridge.js", "web/data/dry_ridge.js"):
        text = open(os.path.join(ROOT, path), encoding="utf-8").read()
        d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
        f = {n: i for i, n in enumerate(d["fields"])}
        col = lambda k: [r[f[k]] for r in d["rows"]]
        out.append({"v": [x / MPH if x is not None else None for x in col("speed_mph")], "lon": col("lon_g"), "lat": col("lat_g"),
                    "dist": col("distance_m"),
                    "corners": [{"start": int(round(e["start_m"] / 5)), "end": int(round(e["end_m"] / 5)), "apex": e["index"],
                                 "apex_mps": e["apex_mph"] / MPH} for e in d["events"] if e["type"] == "corner"]})
    return out


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_js_port_agrees_and_says_it_in_words():
    cases = []
    for kinds in (["ok"] * 3 + ["jerky"] + ["ok"] * 6 + ["late"] + ["ok"] * 5, ["ok"] * 4, ["ok"] * 7 + ["over"] + ["ok"] * 5):
        v, lon, lat, cs = drive(kinds)
        cases.append({"v": v, "lon": lon, "lat": lat, "dist": None, "corners": cs})
    cases += _shipped()
    script = (
        "const C=require(process.argv[1]+'/web/apex_core.js'),F=require(process.argv[1]+'/web/flow.js');"
        "const cs=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        "process.stdout.write(JSON.stringify(cs.map((c)=>{const r=F.longest(C,c.v,c.lon,c.lat,c.corners,c.dist);"
        "return {r,t:F.text(r,(m)=>(m/1609.344).toFixed(1)+' mi')};})));"
    )
    res = subprocess.run([NODE, "-e", script, ROOT], input=json.dumps(cases), capture_output=True, text=True, check=True)
    js = json.loads(res.stdout)
    for c, got in zip(cases, js):
        want = flow.longest_flow(c["v"], c["lon"], c["lat"], c["corners"], c["dist"])
        if want is None:
            assert got["r"] is None and got["t"] is None
        else:
            assert got["r"]["corners"] == want["corners"]
            assert got["r"]["start_m"] == pytest.approx(want["start_m"]) and got["r"]["end_m"] == pytest.approx(want["end_m"])
    assert js[0]["t"].startswith("Your best run: 6 corners in a row, smooth and settled over ") and js[0]["t"].endswith(" mi.")
    assert js[2]["r"]["corners"] == 7


def test_the_drive_page_says_it():
    src = open(os.path.join(ROOT, "web", "drive_view.js"), encoding="utf-8").read()
    assert "FL.longest(Core, d.speed_mps, d.lon_g, d.lat_g, d.corners" in src
    assert "(flow ? `<p class=\"dv-plain\">${esc(flow)}</p>` : '')" in src
    page = open(os.path.join(ROOT, "web", "analysis.html"), encoding="utf-8").read()
    assert page.index('<script src="flow.js"></script>') < page.index('<script src="drive_view.js"></script>')
    assert "REC.runOf(Core, d)" in src


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_log_keeps_each_drives_best_run_in_its_summary():
    v, lon, lat, cs = drive(["ok"] * 3 + ["jerky"] + ["ok"] * 6)
    n = len(v)
    d = {"id": "t1", "name": "Test Rd", "date": "2026-11-11T09:00:00", "speed_mps": v, "lon_g": lon, "lat_g": lat,
         "dist": [5.0 * i for i in range(n)], "lat": [35.5 + 5.0 * i / 110540 for i in range(n)], "lon": [-83.9] * n,
         "events": [{"type": "corner", "start_m": c["start"] * 5, "end_m": c["end"] * 5, "index": c["apex"], "apex_mph": c["apex_mps"] * MPH,
                     "code": "L4", "call": "left 4", "dir": "L", "severity": 4, "turn_rad": 1} for c in cs]}
    script = (
        "globalThis.ApexCore=require(process.argv[1]+'/web/apex_core.js');const R=require(process.argv[1]+'/web/recording.js');"
        "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const s=R.summarize(ApexCore,d),r=R.runOf(ApexCore,d);"
        "process.stdout.write(JSON.stringify({run:s.run,r,sv:s.sv}));"
    )
    out = json.loads(subprocess.run([NODE, "-e", script, ROOT], input=json.dumps(d), capture_output=True, text=True, check=True).stdout)
    assert out["sv"] == 2                                                # summaries made before the run are rebuilt
    assert out["r"]["corners"] == 6 and out["run"]["corners"] == 6
    assert out["run"]["len_m"] == pytest.approx(out["r"]["end_m"] - out["r"]["start_m"])


def test_the_records_and_the_workers_have_it():
    page = open(os.path.join(ROOT, "web", "analysis.html"), encoding="utf-8").read()
    assert "Best run this month: corners in a row, smooth and settled" in page
    assert page.index('<script src="flow.js"></script>') < page.index('<script src="recording.js"></script>')
    for f in ("analysis_worker.js", "break_worker.js"):
        assert "'flow.js', 'recording.js'" in open(os.path.join(ROOT, "web", f), encoding="utf-8").read(), f
    idx = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert idx.index('<script src="flow.js" defer>') < idx.index('<script src="recording.js" defer>')
