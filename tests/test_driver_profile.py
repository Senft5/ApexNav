"""Your driving (core/driver_profile.py, web/driver_profile.js): six skills read from every clean corner of every drive,
where the driver is measurably better or worse, and the months. Each fault is planted in a made-up drive and must lower
its own skill and no other; a difference planted on one side (rights, downhill, a car) must be found and named, and
identical driving must find nothing. The JS port is held to the Python on the same drives, and on the shipped real ones.
"""
import re
import json
import math
import os
import shutil
import subprocess

import numpy as np
import pytest

from core import driver_profile as dp

NODE = shutil.which("node")
G = 9.80665
KIND = {"tight": (2, 11.0, 0.45), "medium": (4, 15.0, 0.38), "fast": (5, 19.0, 0.30)}   # severity, corner speed, peak lateral g


def make_drive(seed, corners=30, fault=None, noise=True, cruise=22.0, uphill=None):
    """A drive of `corners` corners 400 m apart, alternating left and right and cycling tight, medium, fast: the car
    brakes once on the straight, holds the corner speed to the apex and drives out. fault(i, way, size) names what goes
    wrong in corner i: 'saw' (two steering corrections), 'stab' (braking in two goes), 'late' (braking after the apex),
    'lift' (a second slowing mid-corner), 'early' (slowest 35 m before the apex) or 'coast' (50 m between brakes and
    throttle). uphill(i): True climbs through corner i, False descends, None is level."""
    rng = np.random.default_rng(seed)
    block, half = 80, 7
    n = corners * block + 40
    v = np.full(n, cruise)
    lat = np.zeros(n)
    elev = np.zeros(n)
    out = []
    for i in range(corners):
        way = "L" if i % 2 == 0 else "R"
        size = ("tight", "medium", "fast")[i % 3]
        sev, vc, peak = KIND[size]
        apex = 50 + i * block
        s, e = apex - half, apex + half
        f = fault(i, way, size) if fault else None
        low = apex - 7 if f == "early" else apex            # where the car is slowest
        bins = 12                                           # 60 m of braking, off the brakes 10 m before the slowest point
        b1 = low - 2
        b0 = b1 - bins
        v[b0:b1 + 1] = np.linspace(cruise, vc, bins + 1)
        v[b1:low + 1] = vc
        gap = 10 if f == "coast" else 0
        v[low:low + gap + 1] = vc
        up = low + gap
        v[up:up + 14] = np.linspace(vc, cruise, 14)
        if f == "stab":                                     # off the brakes for 20 m half-way, then on again harder
            mid = b0 + 4
            v[b0:mid + 1] = np.linspace(cruise, cruise - 0.4 * (cruise - vc), 5)
            v[mid:mid + 4] = v[mid]
            v[mid + 3:b1 + 1] = np.linspace(v[mid], vc, b1 - mid - 2)
        if f == "lift":                                     # back on the power too early, then a second slowing
            v[apex - 6:apex - 1] = vc + np.array([1.0, 2.0, 2.5, 2.0, 1.0])
        sign = 1.0 if way == "L" else -1.0
        shape = np.concatenate([np.linspace(0, 1, 5), np.ones(2 * half - 9), np.linspace(1, 0, 5)])
        if f == "saw":
            shape[5:7] -= 0.45
            shape[9:11] -= 0.45
        lat[s:e + 1] = sign * peak * shape
        if uphill and uphill(i) is not None:
            elev[s - 12:] += (1 if uphill(i) else -1) * np.minimum(np.arange(n - s + 12), 2 * half + 24) * 5.0 * 0.07
        out.append({"start": s, "end": e, "apex": apex, "apex_mps": vc / 0.6, "dir": way, "severity": sev,
                    "mods": ["tightens"] if i % 5 == 0 else []})
    lon = np.zeros(n)
    lon[:-1] = (v[1:] - v[:-1]) * v[:-1] / 5.0 / G
    for c, i in zip(out, range(corners)):
        if fault and fault(i, c["dir"], ("tight", "medium", "fast")[i % 3]) == "late":
            lon[c["apex"] + 1:c["apex"] + 4] = -0.32
    if noise:
        lat += rng.normal(0, 0.012, n)
        lon += rng.normal(0, 0.012, n)
        v += rng.normal(0, 0.05, n)
    return {"speed_mps": v.tolist(), "lon_g": lon.tolist(), "lat_g": lat.tolist(), "elev": elev.tolist(), "corners": out}


def entry(drive, i, month="2026-09", car=None, tags=None):
    return {"id": f"d{i}", "month": month, "car": car, "tags": tags, "obs": dp.observe(drive)}


def levels(p):
    return {k: p["skills"][k]["level"] for k in dp.SKILLS}


def test_clean_driving_scores_high_everywhere_and_finds_nothing():
    p = dp.profile([entry(make_drive(s), s) for s in range(6)])
    assert p["corners"] == 180 and p["drives"] == 6
    assert all(v is not None and v >= 93 for v in levels(p).values()), levels(p)
    assert p["findings"] == [] and p["focus"] is None                      # nothing is short: nothing to work on
    assert p["style"]["trail_share"] == 1 and abs(p["style"]["slow_m"]) <= 5   # brakes into every corner, slowest at the apex


@pytest.mark.parametrize("fault,skill", [("stab", "squeeze"), ("late", "brake"), ("saw", "arc"), ("lift", "entry"),
                                         ("early", "line"), ("coast", "exit")])
def test_each_fault_lowers_its_own_skill(fault, skill):
    clean = levels(dp.profile([entry(make_drive(s), s) for s in range(4)]))
    bad = dp.profile([entry(make_drive(s, fault=lambda i, way, size: fault if i % 2 else None), s) for s in range(4)])
    lv = levels(bad)
    assert lv[skill] <= clean[skill] - 15, (fault, lv, clean)
    assert bad["focus"]["skill"] == skill
    for k in dp.SKILLS:                                                     # ...and leaves the others where they were
        if k != skill and not (fault, k) in {("lift", "squeeze")}:
            assert lv[k] >= clean[k] - 6, (fault, k, lv, clean)


def test_a_weakness_on_one_side_is_found_and_named():
    # sawing at the wheel in right-handers only, on every drive
    p = dp.profile([entry(make_drive(s, fault=lambda i, way, size: "saw" if way == "R" else None), s) for s in range(5)])
    f = p["findings"][0]
    assert (f["skill"], f["split"], f["a"], f["b"]) == ("arc", "dir", "L", "R")
    assert f["mean_a"] - f["mean_b"] >= 30 and f["drives"] == 5 and f["agree"] == 5
    assert p["focus"] == {"skill": "arc", "where": {"split": "dir", "a": "L", "b": "R", "worse": "R"}}
    by = {(m["dir"], m["size"]): m["levels"]["arc"] for m in p["matrix"]}
    assert all(by[("L", s)] - by[("R", s)] >= 30 for s in ("tight", "medium", "fast"))


def test_a_difference_that_is_only_the_road_is_not_a_finding():
    # every tight corner is sawed at, and on these roads four tight corners in five are lefts: lefts look worse as
    # measured, but the size is the cause, so no left-against-right finding is made
    def fault(i, way, size):
        return "saw" if size == "tight" else None
    ds = []
    for s in range(5):
        e = entry(make_drive(s, corners=60, fault=fault), s)
        e["obs"] = [o for k, o in enumerate(o for o in e["obs"]) if not ((o["size"] == "tight") == (o["dir"] == "R") and k % 5)]
        ds.append(e)
    lefts = [o["arc"] for d in ds for o in d["obs"] if o["dir"] == "L"]
    rights = [o["arc"] for d in ds for o in d["obs"] if o["dir"] == "R"]
    assert np.mean(rights) - np.mean(lefts) > 0.2 and min(len(lefts), len(rights)) > 60
    p = dp.profile(ds)
    assert {(f["split"], f["a"]) for f in p["findings"]} == {("size", "tight"), ("size", "fast")}
    tight = next(f for f in p["findings"] if f["a"] == "tight")
    assert tight["skill"] == "arc" and tight["mean_a"] < tight["mean_b"]


def test_downhill_braking_and_the_first_minutes():
    # braking runs past the apex going downhill; the first ten minutes (about 13 km here) have a second slowing mid-corner
    def fault(i, way, size):
        return "late" if i % 4 == 1 else ("lift" if i < 24 and i % 4 == 2 else None)
    ds = [make_drive(s, corners=60, fault=fault, uphill=lambda i: False if i % 4 == 1 else (True if i % 4 == 3 else None)) for s in range(4)]
    p = dp.profile([entry(d, s) for s, d in enumerate(ds)])
    found = {(f["split"], f["a"]): f for f in p["findings"]}
    assert found[("grade", "down")]["skill"] == "brake" and found[("grade", "down")]["mean_a"] < found[("grade", "down")]["mean_b"]
    assert found[("time", "start")]["skill"] == "entry" and found[("time", "start")]["mean_a"] < found[("time", "start")]["mean_b"]


def test_a_car_and_a_tag_are_compared_drive_against_drive():
    coast = lambda i, way, size: "coast" if i % 2 else None
    ds = [entry(make_drive(s, fault=coast if s < 5 else None), s, car="Truck" if s < 5 else "Miata",
                tags=["rain"] if s % 2 else None) for s in range(10)]
    p = dp.profile(ds)
    cars = [f for f in p["findings"] if f["split"] == "car"]
    assert {(f["a"], f["skill"]) for f in cars} == {("Truck", "exit"), ("Miata", "exit")}
    assert not [f for f in p["findings"] if f["split"] == "tag"]            # rain made no difference: not said
    # three drives of a car are too few to say anything about it
    few = dp.profile([d for d in ds if d["car"] == "Miata"] + [d for d in ds if d["car"] == "Truck"][:3])
    assert not [f for f in few["findings"] if f["split"] == "car"]


def test_months_and_change():
    saw = lambda i, way, size: "saw" if i % 2 else None
    ds = [entry(make_drive(s, fault=saw if s < 2 else None), s, month="2026-08" if s < 2 else ("2026-10" if s < 4 else None)) for s in range(5)]
    p = dp.profile(ds)
    assert [r["month"] for r in p["trend"]["arc"]] == ["2026-08", "2026-10"]  # the undated drive is in no month
    ch = p["change"]["arc"]
    assert ch["from"] == "2026-08" and ch["to"] == "2026-10" and ch["delta"] >= 15 and ch["sure"] is True
    assert p["change"]["squeeze"]["sure"] is False and abs(p["change"]["squeeze"]["delta"]) <= 3


def test_unknown_stays_unknown():
    d = make_drive(1, corners=9)
    p = dp.profile([entry(d, 0)])
    assert all(v is None for v in levels(p).values())                       # nine corners: no level yet
    assert p["strongest"] is None and p["focus"] is None and p["findings"] == []
    assert p["skills"]["arc"]["n"] == 9
    # g not measured over a corner's approach: the corner is left out, not read as smooth
    known = [1] * len(d["lat_g"])
    c = d["corners"][4]
    for q in range(c["start"] - 10, c["start"]):
        known[q] = 0
    assert len(dp.observe({**d, "g_known": known})) == 8
    # a blank speed inside a corner likewise
    v = list(d["speed_mps"])
    v[d["corners"][2]["apex"]] = None
    assert len(dp.observe({**d, "speed_mps": v})) == 8
    # a fast corner with no braking has no braking to judge, and no slowest point to place
    o = [x for x in dp.observe(make_drive(2, cruise=19.0)) if x["size"] == "fast"][0]
    assert o["squeeze"] is None and o["brake"] is None and o["line"] is None and o["exit"] is None and o["arc"] is not None
    assert dp.profile([]) ["corners"] == 0 and dp.profile([{"id": "x", "obs": []}])["drives"] == 0


def test_identical_driving_with_noise_finds_nothing():
    # 12 different noise seeds, nothing planted: no comparison may come out as a finding
    for k in range(12):
        ds = [entry(make_drive(100 * k + s, uphill=lambda i: (True, False, None)[i % 3]), s, car=("A", "B")[s % 2], tags=["x"] if s % 3 == 0 else None)
              for s in range(8)]
        assert dp.profile(ds)["findings"] == [], k


def _shipped():
    out = []
    for path in ("web/data/pebble_ridge.js", "web/data/dry_ridge.js"):
        if not os.path.exists(path):
            return None
        text = open(path, encoding="utf-8").read()
        d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
        f = {name: i for i, name in enumerate(d["fields"])}
        col = lambda k: [r[f[k]] for r in d["rows"]]
        out.append({"speed_mps": [v / 2.2369362921 for v in col("speed_mph")], "lon_g": col("lon_g"), "lat_g": col("lat_g"), "elev": col("elevation_m"),
                    "corners": [{"start": int(round(e["start_m"] / 5)), "end": int(round(e["end_m"] / 5)), "apex": e["index"],
                                 "apex_mps": e["apex_mph"] / 2.2369362921, "dir": e.get("dir"), "severity": e.get("severity"),
                                 "mods": e.get("mods")} for e in d["events"] if e["type"] == "corner"]})
    return out


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_parity_with_the_js_port():
    saw = lambda i, way, size: "saw" if way == "R" else ("late" if i % 4 == 0 else ("coast" if i % 7 == 0 else None))
    drives = [make_drive(s, fault=saw if s % 2 else (lambda i, way, size: ("stab", "lift", "early", None)[i % 4]),
                         uphill=lambda i: (True, False, None)[i % 3]) for s in range(8)]
    gk = [1] * len(drives[0]["lat_g"])
    gk[400:460] = [0] * 60
    drives[0] = {**drives[0], "g_known": gk}
    v = list(drives[1]["speed_mps"])
    v[130] = None
    drives[1] = {**drives[1], "speed_mps": v, "elev": None}
    drives += _shipped() or []
    meta = [{"id": f"d{i}", "month": (None, "2026-08", "2026-09", "2026-10")[i % 4], "car": (None, "Miata", "Truck")[i % 3],
             "tags": (None, ["rain"], ["rain", "night"])[i % 3]} for i in range(len(drives))]
    py_obs = [dp.observe(d) for d in drives]
    py = dp.profile([{**m, "obs": o} for m, o in zip(meta, py_obs)])
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const [ds,meta]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const obs=ds.map((d)=>P.observe(d));process.stdout.write(JSON.stringify({obs,p:P.profile(meta.map((m,i)=>({...m,obs:obs[i]})))}));")
    out = subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([drives, meta]), capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    assert len(py["findings"]) >= 2 and sum(len(o) for o in py_obs) > 200
    for a, b in zip(js["obs"], py_obs):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            assert set(x) == set(y)
            for k in y:
                assert x[k] == (pytest.approx(y[k], abs=1e-9) if isinstance(y[k], float) else y[k]), k

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
            assert x == pytest.approx(y, abs=1e-6), at
        else:
            assert x == y, at
    same(js["p"], py)


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_words():
    saw = lambda i, way, size: "saw" if way == "R" else None
    ds = [entry(make_drive(s, fault=saw), s) for s in range(5)]
    few = [entry(make_drive(1, corners=9), 0)]
    runner = ("const P=require(process.argv[1]+'/web/driver_profile.js');const [ds,few]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const p=P.profile(ds),q=P.profile(few);process.stdout.write(JSON.stringify({card:P.cardLine(p),few:P.cardLine(q),none:P.cardLine(P.profile([])),"
              "focus:P.focusLines(p),nofocus:P.focusLines(q),find:p.findings.map(P.findingLine),"
              "rest:P.findingLine({skill:'line',split:'size',a:'tight',b:'rest',mean_a:100,mean_b:85,drives:4,agree:4,also:['exit']}),"
              "car:P.findingLine({skill:'exit',split:'car',a:'Truck',b:'rest',mean_a:50,mean_b:99,drives:10,agree:null,also:[]}),"
              "style:[P.styleLines({trail_share:0.72,slow_m:-8.2,use:0.58},true),P.styleLines({trail_share:0.1,slow_m:1,use:1.02},false),P.styleLines({trail_share:null,slow_m:null,use:null})]}));")
    out = json.loads(subprocess.run([NODE, "-e", runner, os.getcwd()], input=json.dumps([ds, few]), capture_output=True, text=True, check=True).stdout)
    assert out["card"].startswith("Best: ") and "Work on: One steering arc" in out["card"]
    assert out["few"] == "9 of 30 clean corners to your first picture" and out["none"] is None
    assert out["focus"]["head"] == "Work on: One steering arc" and re.fullmatch(r"Through rights \d+, through lefts \d+, on 5 of 5 drives\.", out["focus"]["where"])
    assert out["nofocus"] is None
    assert re.fullmatch(r"One steering arc: through rights \d+, through lefts \d+, on 5 of 5 drives\.", out["find"][0])
    # the side with a name is the one spoken of, and a whole-drive comparison counts drives, not votes
    assert out["rest"] == "Patient apex: in tight corners 100, in the rest 85, on 4 of 4 drives. The same shows in back to power."
    assert out["car"] == "Back to power: in the Truck 50, in your other cars 99, across 10 drives."
    a, b, c = out["style"]
    assert a == ["Still braking at turn-in: 7 of 10 corners you brake for",
                 "Slowest point: 8 m before the middle", "Kept in hand: about 40% of the sane limit"]
    assert b[0] == "Still braking at turn-in: 1 of 10 corners you brake for"
    assert b[1] == "Slowest point: the middle of the corner" and "leave more in hand" in b[2] and c == []
    text = " ".join(out["find"] + a + b + [out["card"], out["focus"]["tip"]])
    assert not any(w in text.lower() for w in ("faster", "quicker", "mph", "km/h", "seconds"))      # technique, never pace
