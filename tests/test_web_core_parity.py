"""web/apex_core.js must compute exactly what core/road_dna.py computes."""
import json
import math
import os
import shutil
import subprocess

import numpy as np
import pytest

from core import road_dna as rd
from tests.synthetic import path_from_legs

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

JS_RUNNER = r"""
const core = require(process.argv[1]);
const inp = JSON.parse(require('fs').readFileSync(0, 'utf8'));
let lat = inp.lat, lon = inp.lon;
if (inp.resample) ({ lat, lon } = core.resamplePolyline(lat, lon, 5));
const { kappa, ds } = core.computeCurvature(lat, lon);
const sight = core.sightDistanceM(lat, lon, inp.elev);
const env = core.brakingEnvelopeMps(kappa, ds, inp.camber, inp.rough, undefined, sight);
const corners = core.annotateCautions(core.detectCorners(kappa, ds, inp.camber, inp.crest, inp.rough), env, sight)
  .map(c => Object.assign(c, { text: core.paceNoteText(c) }));
const notes = core.linkNotes(corners.map(c => ({ start_m: c.start * 5, end_m: c.end * 5 })));
corners.forEach((c, i) => { c.link = notes[i].link; });
process.stdout.write(JSON.stringify({ lat, kappa: Array.from(kappa), sight: Array.from(sight), env: Array.from(env), corners }));
"""


def _run_js(payload: dict) -> dict:
    core_path = os.path.abspath("web/apex_core.js")
    out = subprocess.run([NODE, "-e", JS_RUNNER, core_path], input=json.dumps(payload),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def _assert_parity(lat, lon, camber=None, crest=None, rough=None, resample=False, elev=None):
    payload = {"lat": list(map(float, lat)), "lon": list(map(float, lon)), "resample": resample,
               "camber": None if camber is None else list(map(float, camber)),
               "crest": None if crest is None else list(map(float, crest)),
               "rough": None if rough is None else list(map(float, rough)),
               "elev": None if elev is None else list(map(float, elev))}
    js = _run_js(payload)
    if resample:
        lat, lon = rd.resample_polyline(lat, lon, 5.0)
        np.testing.assert_allclose(js["lat"], lat, atol=1e-10)
    kappa, ds = rd.compute_curvature(lat, lon)
    sight = rd.sight_distance_m(lat, lon, elev)
    env = rd.braking_envelope_mps(kappa, ds, camber, rough, sight_m=sight)
    corners = rd.annotate_cautions(rd.detect_corners(kappa, ds, camber, crest, rough), env, sight)
    links = rd.link_notes([{"start_m": c["start"] * 5.0, "end_m": c["end"] * 5.0} for c in corners])
    np.testing.assert_allclose(js["kappa"], kappa, atol=1e-9)
    np.testing.assert_allclose(js["sight"], sight, atol=1e-9)
    np.testing.assert_allclose(js["env"], env, rtol=1e-9)
    assert len(js["corners"]) == len(corners)
    for a, b, ln in zip(js["corners"], corners, links):
        assert (a["start"], a["apex"], a["end"], a["dir"], a["severity"], a["mods"], a["grade"], a["shape"], a["caution"]) == \
               (b["start"], b["apex"], b["end"], b["dir"], b["severity"], b["mods"], b["grade"], b["shape"], b["caution"])
        assert a["link"] == ln["link"]
        assert a["arc_m"] == pytest.approx(b["arc_m"], rel=1e-9)
        assert a["apex_mps"] == pytest.approx(b["apex_mps"], rel=1e-9)
        assert tuple(a["text"].values()) == rd.pace_note_text(b)
    return corners


def test_parity_on_synthetic_stage_with_noise():
    legs = [("straight", 250.0), ("arc", 20.0, 150.0), ("straight", 120.0), ("arc", 70.0, -80.0),
            ("arc", 35.0, -50.0), ("straight", 300.0), ("arc", 200.0, 45.0), ("straight", 200.0)]
    lat, lon = path_from_legs(legs, noise_m=0.6)
    n = len(lat)
    rng = np.random.default_rng(11)
    camber = np.radians(rng.normal(0.0, 2.0, n))
    crest = rng.normal(0.0, 0.04, n)
    rough = np.abs(rng.normal(0.06, 0.05, n))
    assert len(_assert_parity(lat, lon)) >= 3
    _assert_parity(lat, lon, camber, crest, rough)


def test_parity_on_irregular_polyline_like_osrm():
    lat, lon = path_from_legs([("straight", 400.0), ("arc", 60.0, 100.0), ("straight", 400.0)], step_m=1.0)
    keep = np.unique(np.concatenate([[0], np.sort(np.random.default_rng(5).choice(len(lat), 90, replace=False)),
                                     [len(lat) - 1]]))
    _assert_parity(lat[keep], lon[keep], resample=True)


def test_parity_on_real_logged_drive():
    path = "web/data/pebble_ridge.js"
    if not os.path.exists(path):
        pytest.skip("no shipped drive data")
    text = open(path, encoding="utf-8").read()
    d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
    f = {name: i for i, name in enumerate(d["fields"])}
    rows = np.array(d["rows"][:2500], dtype=float)
    _assert_parity(rows[:, f["lat"]], rows[:, f["lon"]], np.radians(rows[:, f["camber_deg"]]),
                   rows[:, f["crest_vertical_g"]], rows[:, f["roughness_rms"]], elev=rows[:, f["elevation_m"]])
    assert math.isfinite(rows[:, f["lat"]].sum())


def test_parity_drive_analysis_on_real_overlapping_drives():
    from core import drive_analysis as da
    paths = ["web/data/pebble_ridge.js", "web/data/dry_ridge.js"]
    if not all(os.path.exists(p) for p in paths):
        pytest.skip("no shipped drive data")

    def load(path):
        text = open(path, encoding="utf-8").read()
        d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
        f = {name: i for i, name in enumerate(d["fields"])}
        rows = np.array([[r[f[k]] for k in ("lat", "lon", "speed_mph", "lon_g", "lat_g")] for r in d["rows"]], dtype=float)
        corners = [{"start": int(round(e["start_m"] / 5)), "end": int(round(e["end_m"] / 5)), "apex": e["index"],
                    "apex_mps": e["apex_mph"] / 2.2369362921, "code": e["code"], "call": e["call"]}
                   for e in d["events"] if e["type"] == "corner"]
        return {"lat": rows[:, 0], "lon": rows[:, 1], "speed_mps": rows[:, 2] / 2.2369362921,
                "lon_g": rows[:, 3], "lat_g": rows[:, 4], "corners": corners}

    a, b = load(paths[0]), load(paths[1])
    py = da.compare(a, b)
    js_in = {k: (v.tolist() if hasattr(v, "tolist") else v) for k, v in a.items()}, \
            {k: (v.tolist() if hasattr(v, "tolist") else v) for k, v in b.items()}
    runner = "const c=require(process.argv[1]);const [a,b]=JSON.parse(require('fs').readFileSync(0,'utf8'));" \
             "process.stdout.write(JSON.stringify(c.compareDrives(a,b)));"
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")], input=json.dumps(js_in),
                         capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    assert js["matched_corners"] == py["matched_corners"] and js["overlap_m"] == py["overlap_m"]
    assert js["corner_delta_s"] == pytest.approx(py["corner_delta_s"], abs=1e-9)
    assert js["overlap_delta_s"] == pytest.approx(py["overlap_delta_s"], abs=1e-6)
    for cj, cp in zip(js["corners"], py["corners"]):
        assert cj["stopped"] == cp["stopped"] and (cj["b"] is None) == (cp["b"] is None)
        for side in ("a", "b"):
            if cp[side] is None:
                continue
            for k, v in cp[side].items():
                assert cj[side][k] == (None if v is None else pytest.approx(v, rel=1e-9, abs=1e-9)), k
    assert len(js["delta_curve"]) == len(py["delta_curve"])


def test_parity_coach_on_real_drives():
    from core import drive_analysis as da
    paths = ["web/data/pebble_ridge.js", "web/data/dry_ridge.js"]
    if not all(os.path.exists(p) for p in paths):
        pytest.skip("no shipped drive data")
    drives = []
    for path in paths:
        text = open(path, encoding="utf-8").read()
        d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
        f = {name: i for i, name in enumerate(d["fields"])}
        col = lambda k: [r[f[k]] for r in d["rows"]]
        drives.append({"lat": col("lat"), "lon": col("lon"), "speed_mps": [v / 2.2369362921 for v in col("speed_mph")],
                       "lon_g": col("lon_g"), "lat_g": col("lat_g"),
                       "corners": [{"start": int(round(e["start_m"] / 5)), "end": int(round(e["end_m"] / 5)), "apex": e["index"],
                                    "apex_mps": e["apex_mph"] / 2.2369362921} for e in d["events"] if e["type"] == "corner"]})
    # a third pass: the second drive 4 % quicker, with blank g through part of it
    quick = dict(drives[1], speed_mps=[v * 1.04 for v in drives[1]["speed_mps"]],
                 g_known=[0 if 3000 <= i < 3400 else 1 for i in range(len(drives[1]["lat"]))])
    # and a fourth that brakes and lifts two bins (10 m) later everywhere, so the spread across passes is not zero
    late = dict(drives[1], speed_mps=[v * 0.98 for v in drives[1]["speed_mps"]], lon_g=drives[1]["lon_g"][:2] + drives[1]["lon_g"][:-2])
    later = dict(drives[1], lon_g=drives[1]["lon_g"][:4] + drives[1]["lon_g"][:-4])
    # and passes on their own GPS traces (a few metres off), so the marks are projected onto A's road
    shifted = [dict(late, lat=[x + 3e-5 * math.sin(i / 7 + k) for i, x in enumerate(drives[1]["lat"])],
                    lon=[x + 4e-5 * math.cos(i / 5 + k) for i, x in enumerate(drives[1]["lon"])]) for k in (1, 2)]
    cases = [(drives[0], [drives[1]]), (drives[1], [drives[0], quick]), (drives[1], []), (drives[1], [quick, late, later]),
             (drives[1], [*shifted, later]), (drives[1], [quick, late, later, *shifted])]
    # and a slower pass that turned in 15 m sooner everywhere (D-18)
    early = dict(drives[1], speed_mps=[v * 0.96 for v in drives[1]["speed_mps"]], lat_g=drives[1]["lat_g"][3:] + drives[1]["lat_g"][-3:])
    cases.append((early, [drives[1]]))
    np_ = lambda d: {**d, "speed_mps": np.array(d["speed_mps"]), "lon_g": np.array(d["lon_g"]), "lat_g": np.array(d["lat_g"])}
    py = [da.coach(np_(a), [np_(o) for o in others]) for a, others in cases]
    keys = ["2026-09", "2026-09", "2026-09", "2026-09", "2026-09", "2026-10", None]
    runner = (f"const KEYS={json.dumps(keys)};"
              "const c=require(process.argv[1]);const cases=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify(cases.map(([a,o])=>{const r=c.coach(a,o);r.dev=c.spreadBy(r,KEYS);return r;})));")
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")], input=json.dumps(cases),
                         capture_output=True, text=True, check=True)
    tips = 0
    js_all = json.loads(out.stdout)
    for j, p in zip(js_all, py):
        assert (j["clean"], j["top"]) == (p["clean"], p["top"])
        assert j["ideal_s"] == pytest.approx(p["ideal_s"], rel=1e-9) and j["gain_s"] == pytest.approx(p["gain_s"], rel=1e-9, abs=1e-9)
        assert len(j["corners"]) == len(p["corners"])
        for cj, cp in zip(j["corners"], p["corners"]):
            assert (cj["passes"], cj["best"] is None, cj["gain_s"] is None) == (cp["passes"], cp["best"] is None, cp["gain_s"] is None)
            if cp["gain_s"] is not None:
                assert cj["gain_s"] == pytest.approx(cp["gain_s"], rel=1e-9, abs=1e-9) and cj["best_from"] == cp["best_from"]
            assert (cj["tip"] is None) == (cp["tip"] is None)
            if cp["tip"]:
                tips += 1
                assert cj["tip"]["kind"] == cp["tip"]["kind"] and cj["tip"]["value"] == pytest.approx(cp["tip"]["value"], rel=1e-9)
            if "spread" in cp:
                for k, v in cp["spread"].items():
                    if k == "marks":
                        assert cj["spread"][k] == v                                       # whole multiples of 5 m, or None
                        continue
                    assert cj["spread"][k] == (None if v is None else pytest.approx(v, rel=1e-9, abs=1e-9)), k
            else:
                assert "spread" not in cj
            for side in ("m", "best"):
                if cp[side] is not None:
                    for k, v in cp[side].items():
                        assert cj[side][k] == (None if v is None else pytest.approx(v, rel=1e-9, abs=1e-9)), k
    assert tips > 0 and py[1]["clean"] > 0 and py[1]["gain_s"] > 0
    kinds = lambda r: [c["tip"]["kind"] for c in r["corners"] if c["tip"]]
    assert "turn_in_later" in kinds(py[6])                                         # turned in sooner than the quicker pass
    assert "turn_in_later" not in kinds(py[4]) + kinds(py[5])                      # same steering, other GPS traces: no such tip
    for j, p in zip(js_all, py):                                                    # spread per period (D-07 trend)
        by = da.spread_by(p, keys)
        assert sorted(j["dev"]) == sorted(by)
        for k, v in by.items():
            assert [x[0] for x in j["dev"][k]] == [x[0] for x in v]
            assert [x[1] for x in j["dev"][k]] == pytest.approx([x[1] for x in v], rel=1e-12)
    assert da.spread_by(py[5], keys) and da.spread_by(py[3], keys) == {}             # five passes in a month give figures, four none
    assert "2026-10" not in da.spread_by(py[5], keys)                                 # one pass in October says nothing
    whole = [c["spread"]["brake_sd_m"] for c in py[5]["corners"] if c.get("spread") and c["spread"]["brake_passes"] >= 5]
    assert whole and [x[1] for x in da.spread_by(py[5], ["x"] * 6)["x"]] == pytest.approx(whole)   # one period: the spreads               # one period: the corner spreads themselves
    spreads = [c["spread"]["brake_sd_m"] for c in py[3]["corners"] if c.get("spread") and c["spread"]["brake_sd_m"] is not None]
    assert spreads and max(spreads) > 0                                            # braking 0, 0, 10 and 20 m later: a spread
    assert all(c["spread"]["brake_sd_m"] is None for c in py[0]["corners"] if c.get("spread"))   # two passes say nothing


def test_parity_friction_circle_on_real_drives():
    from core import drive_analysis as da
    path = "web/data/dry_ridge.js"
    if not os.path.exists(path):
        pytest.skip("no shipped drive data")
    text = open(path, encoding="utf-8").read()
    d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
    f = {name: i for i, name in enumerate(d["fields"])}
    lat = [r[f["lat_g"]] for r in d["rows"]]
    lon = [r[f["lon_g"]] for r in d["rows"]]
    known = [0 if 2000 <= i < 2600 else 1 for i in range(len(lat))]
    spans = [(i, i + 30) for i in range(0, len(lat) - 31, 997)]
    py_env = da.gg_envelope(lat, lon, known)
    py = {"env": py_env, "use": [da.grip_use(lat, lon, a, b, py_env, known) for a, b in spans]}
    runner = ("const c=require(process.argv[1]);const {lat,lon,known,spans}=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const env=c.ggEnvelope(lat,lon,known);"
              "process.stdout.write(JSON.stringify({env,use:spans.map(([a,b])=>c.gripUse(lat,lon,a,b,env,known))}));")
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")],
                         input=json.dumps({"lat": lat, "lon": lon, "known": known, "spans": spans}), capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    assert js["env"]["points"] == py["env"]["points"] > 1000
    for k in ("radius_g", "peak_g", "brake_g", "throttle_g", "left_g", "right_g"):
        jv, pv = (js["env"][k], py["env"][k]) if k == "radius_g" else ([js["env"][k]], [py["env"][k]])
        assert [x is None for x in jv] == [x is None for x in pv], k          # hypot may differ in the last ulp
        assert [x for x in jv if x is not None] == pytest.approx([x for x in pv if x is not None], rel=1e-12), k
    assert any(u is None for u in py["use"]) and any(u is not None for u in py["use"])
    for j, p in zip(js["use"], py["use"]):
        assert (j is None) == (p is None) and (p is None or j == pytest.approx(p, rel=1e-12))


def test_remove_spurs_cuts_dead_end_out_and_back():
    lat, lon = path_from_legs([("straight", 300.0)])
    # out-and-back spur: 80 m east and back, inserted at sample 30
    spur_lat = [lat[30]] * 17
    spur_lon = [lon[30] + (min(k, 16 - k) * 10.0) / (111320.0 * math.cos(math.radians(lat[30]))) for k in range(17)]
    lat2 = np.concatenate([lat[:30], spur_lat, lat[31:]])
    lon2 = np.concatenate([lon[:30], spur_lon, lon[31:]])
    runner = "const c=require(process.argv[1]);const d=JSON.parse(require('fs').readFileSync(0,'utf8'));" \
             "process.stdout.write(JSON.stringify(c.removeSpurs(d.lat,d.lon)));"
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")],
                         input=json.dumps({"lat": lat2.tolist(), "lon": lon2.tolist()}), capture_output=True, text=True, check=True)
    r = json.loads(out.stdout)
    assert r["removed"] >= 15 and len(r["lat"]) <= len(lat) + 1


def test_parity_driver_score_and_segments_on_real_drives():
    from core import drive_analysis as da
    paths = ["web/data/pebble_ridge.js", "web/data/dry_ridge.js"]
    if not all(os.path.exists(p) for p in paths):
        pytest.skip("no shipped drive data")
    drives = []
    for path in paths:
        text = open(path, encoding="utf-8").read()
        d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
        f = {name: i for i, name in enumerate(d["fields"])}
        col = lambda k: [r[f[k]] for r in d["rows"]]
        lim = [None if v is None else v / 3.6 for v in col("limit_kph")]
        drives.append({"lat": col("lat"), "lon": col("lon"), "speed_mps": [v / 2.2369362921 for v in col("speed_mph")],
                       "lon_g": col("lon_g"), "lat_g": col("lat_g"), "limit_mps": lim,
                       "corners": [{"start": int(round(e["start_m"] / 5)), "end": int(round(e["end_m"] / 5)), "apex": e["index"],
                                    "apex_mps": e["apex_mph"] / 2.2369362921} for e in d["events"] if e["type"] == "corner"]})
    a = drives[1]
    seg = {"lat0": a["lat"][6000], "lon0": a["lon"][6000], "lat1": a["lat"][6400], "lon1": a["lon"][6400], "length_m": 2000.0}
    py = []
    for d in drives:
        py.append({"score": da.driver_score(np.array(d["speed_mps"]), np.array(d["lon_g"]), np.array(d["lat_g"]), d["corners"]),
                   "seg": da.segment_pass(seg, {**d, "speed_mps": np.array(d["speed_mps"]),
                                                 "lon_g": np.array(d["lon_g"]), "lat_g": np.array(d["lat_g"])})})
    runner = ("const c=require(process.argv[1]);const {drives,seg}=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify(drives.map(d=>({score:c.driverScore(d.speed_mps,d.lon_g,d.lat_g,d.corners),"
              "seg:c.segmentPass(seg,d)}))));")
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")], input=json.dumps({"drives": drives, "seg": seg}),
                         capture_output=True, text=True, check=True)
    for j, p in zip(json.loads(out.stdout), py):
        assert j["score"]["score"] == p["score"]["score"]
        assert j["score"]["components"] == p["score"]["components"]
        assert (j["seg"] is None) == (p["seg"] is None)
        if p["seg"]:
            assert (j["seg"]["lo"], j["seg"]["hi"], j["seg"]["score"]) == (p["seg"]["lo"], p["seg"]["hi"], p["seg"]["score"])
            assert j["seg"]["time_s"] == pytest.approx(p["seg"]["time_s"], rel=1e-9)


def test_browser_profiler_matches_the_exporter_on_a_real_drive():
    """Same input to both: the exporter's profile_segments and apex_core.profileRecording."""
    import pandas as pd
    from tools.export_web_profile import profile_segments
    path = "web/data/dry_ridge.js"
    if not os.path.exists(path):
        pytest.skip("no shipped drive data")
    text = open(path, encoding="utf-8").read()
    d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
    seg = pd.DataFrame(d["rows"], columns=d["fields"]).fillna(0.0)
    _, _, events = profile_segments(seg.copy())
    py = [(e["code"], e["call"], e["index"], e["link"]) for e in events]
    assert {"BUMP", "CREST"} <= {p[0] for p in py}                                     # hazards are part of the comparison
    cols = {k: seg[k].tolist() for k in ("distance_m", "lat", "lon", "elevation_m", "speed_mph", "camber_deg",
                                         "crest_vertical_g", "roughness_rms", "vert_peak_g")}
    runner = ("const c=require(process.argv[1]);const cols=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify(c.profileRecording(cols).events.map(e=>[e.code,e.call,e.index,e.link])));")
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")], input=json.dumps(cols),
                         capture_output=True, text=True, check=True)
    js = [tuple(j) for j in json.loads(out.stdout)]
    assert js == py


def test_parity_hazards():
    rng = np.random.default_rng(7)
    n = 900
    dist = np.arange(n) * 5.0
    rough = 0.03 + 0.01 * rng.random(n)
    rough[400:480] = 0.2                                                               # broken pavement: no spike calls
    peak = 0.1 + 0.05 * rng.random(n)
    peak[[100, 104, 300, 450, 700]] = [0.5, 0.8, 0.3, 0.9, 1.1]                       # cluster, sub-threshold, low contrast, two real
    crest = 0.03 * np.sin(dist / 80.0)
    crest[[200, 220, 600]] = [-0.12, -0.2, 0.15]
    cases = [(peak, True), (None, True), (None, False)]
    runner = ("const c=require(process.argv[1]);const {dist,crest,rough,cases}=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify(cases.map(([p,fb])=>c.detectHazards(dist,crest,rough,p,{roughFallback:fb}))));")
    payload = {"dist": dist.tolist(), "crest": crest.tolist(), "rough": rough.tolist(),
               "cases": [[None if p is None else p.tolist(), fb] for p, fb in cases]}
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")], input=json.dumps(payload),
                         capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    with_peak = rd.detect_hazards(dist, crest, rough, peak)
    assert [(h["index"], h["type"]) for h in with_peak] == [(104, "bump"), (220, "crest"), (600, "dip"), (700, "bump")]
    fallback = rd.detect_hazards(dist, crest, rough)
    for got, want in zip(js[:2], [with_peak, fallback]):
        assert [(h["index"], h["type"]) for h in got] == [(h["index"], h["type"]) for h in want]
        assert [h["severity_g"] for h in got] == pytest.approx([h["severity_g"] for h in want], rel=1e-12)
    assert [h["type"] for h in js[2]] == ["crest", "dip"]                              # no roughness stand-in for spikes


def test_hazards_ignore_unmeasured_samples():
    n = 200
    nan = float("nan")
    payload = {"dist": [i * 5.0 for i in range(n)], "crest": [nan] * n, "rough": [nan] * 100 + [0.03] * 100,
               "peak": [nan] * 50 + [0.9] + [nan] * 49 + [0.05] * 50 + [0.9] + [0.05] * 49}
    runner = ("const c=require(process.argv[1]);const p=JSON.parse(require('fs').readFileSync(0,'utf8').replace(/NaN/g,'null'));"
              "process.stdout.write(JSON.stringify(c.detectHazards(p.dist,p.crest,p.rough,p.peak)));")
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")], input=json.dumps(payload),
                         capture_output=True, text=True, check=True)
    # the spike at 50 has no measured roughness around it to stand out from; the one at 150 does
    assert [(h["index"], h["type"]) for h in json.loads(out.stdout)] == [(150, "bump")]


def test_parity_abrupt_moments_on_a_real_drive():
    from core import drive_analysis as da
    path = "web/data/dry_ridge.js"
    if not os.path.exists(path):
        pytest.skip("no shipped drive data")
    text = open(path, encoding="utf-8").read()
    d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
    f = {name: i for i, name in enumerate(d["fields"])}
    lat = [r[f["lat_g"]] for r in d["rows"]]
    lon = [r[f["lon_g"]] for r in d["rows"]]
    v = [r[f["speed_mph"]] / 2.2369362921 for r in d["rows"]]
    known = [0 if 1000 <= i < 1400 else 1 for i in range(len(lat))]
    py = da.abrupt_moments(lat, lon, v, known)
    runner = ("const c=require(process.argv[1]);const {lat,lon,v,known}=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify(c.abruptMoments(lat,lon,v,known)));")
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")],
                         input=json.dumps({"lat": lat, "lon": lon, "v": v, "known": known}), capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    assert [m["index"] for m in js["moments"]] == [m["index"] for m in py["moments"]] and len(py["moments"]) == 3
    assert [x is None for x in js["jerk"]] == [x is None for x in py["jerk"]]
    assert [x for x in js["jerk"] if x is not None] == pytest.approx([x for x in py["jerk"] if x is not None], rel=1e-12)
    assert all(py["jerk"][i] is None for i in range(1000, 1401))                      # unmeasured g: no smoothness claimed


def _long_drive(degrade: bool = False, tighter: bool = False):
    """dry_ridge driven twice (~85 min moving). degrade adds steering chatter and braking past the apex late on;
    tighter makes the late corners load the car 60 % harder, smoothly (a twistier road, not a tired driver)."""
    text = open("web/data/dry_ridge.js", encoding="utf-8").read()
    d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
    f = {name: i for i, name in enumerate(d["fields"])}
    rows, n = d["rows"], len(d["rows"])
    v = [r[f["speed_mph"]] / 2.2369362921 for r in rows] * 2
    lat = [r[f["lat_g"]] for r in rows] * 2
    lon = [r[f["lon_g"]] for r in rows] * 2
    one = [{"start": int(round(e["start_m"] / 5)), "end": int(round(e["end_m"] / 5)), "apex": e["index"],
            "apex_mps": e["apex_mph"] / 2.2369362921} for e in d["events"] if e["type"] == "corner"]
    corners = one + [{**c, "start": c["start"] + n, "end": c["end"] + n, "apex": c["apex"] + n} for c in one]
    for c in corners:
        if c["apex"] <= n * 1.3:
            continue
        if degrade:
            for q in range(c["start"], c["end"] + 1):
                lat[q] += 0.08 if q % 2 else -0.08
            lon[c["apex"] + 1 if c["apex"] < c["end"] else c["apex"]] = -0.4
        if tighter:
            for q in range(c["start"], c["end"] + 1):
                lat[q] *= 1.6
    return v, lat, lon, corners


def _js_fatigue(v, lat, lon, corners, known=None):
    runner = ("const c=require(process.argv[1]);const {v,lat,lon,corners,known}=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify(c.fatigue(v,lon,lat,corners,known)));")
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")],
                         input=json.dumps({"v": v, "lat": lat, "lon": lon, "corners": corners, "known": known}), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_fatigue_flags_a_fade_late_in_a_long_drive_only():
    from core import drive_analysis as da
    if not os.path.exists("web/data/dry_ridge.js"):
        pytest.skip("no shipped drive data")
    v, lat, lon, corners = _long_drive()
    steady = da.fatigue(v, lon, lat, corners)
    assert steady is not None and steady["minutes"] > 60 and steady["cues"] == []      # the same road twice: nothing faded
    v2, lat2, lon2, corners2 = _long_drive(degrade=True)
    assert da.fatigue(v2, lon2, lat2, corners2)["cues"] == ["steering", "braking"]
    v3, lat3, lon3, corners3 = _long_drive(tighter=True)
    assert da.fatigue(v3, lon3, lat3, corners3)["cues"] == []                         # a harder road is not a tired driver
    n = len(v) // 2
    assert da.fatigue(v[:n], lon[:n], lat[:n], [c for c in corners if c["end"] < n]) is None   # 43 min: too short to ask
    assert da.fatigue(v, lon, lat, corners[:10]) is None                                     # too few corners in a third


def test_fatigue_leaves_unmeasured_g_out():
    from core import drive_analysis as da
    if not os.path.exists("web/data/dry_ridge.js"):
        pytest.skip("no shipped drive data")
    v, lat, lon, corners = _long_drive()
    n = len(v)
    # g blank (zero-filled) for the first third, as before the app solves the mount: those corners must not read as perfect
    known = [0 if i < n // 3 else 1 for i in range(n)]
    zl, zo = [0.0 if not k else x for x, k in zip(lat, known)], [0.0 if not k else x for x, k in zip(lon, known)]
    assert da.fatigue(v, zo, zl, corners, known) is None
    assert _js_fatigue(v, zl, zo, corners, known) is None
    # NaN g inside a late corner, and a corner running past the end, are skipped rather than scored or crashing
    late = [c for c in corners if c["apex"] > n * 0.7][0]
    nl = list(lat)
    nl[late["start"] + 1] = float("nan")
    extra = corners + [{"start": n - 3, "end": n + 5, "apex": n - 1, "apex_mps": 20.0}]
    py = da.fatigue(v, lon, nl, extra)
    assert py["late"]["corners"] == da.fatigue(v, lon, lat, corners)["late"]["corners"] - 1


def test_parity_fatigue():
    from core import drive_analysis as da
    if not os.path.exists("web/data/dry_ridge.js"):
        pytest.skip("no shipped drive data")
    for kw in ({}, {"degrade": True}, {"tighter": True}):
        v, lat, lon, corners = _long_drive(**kw)
        py, js = da.fatigue(v, lon, lat, corners), _js_fatigue(v, lat, lon, corners)
        assert js == py


def _dry_ridge_pass():
    text = open("web/data/dry_ridge.js", encoding="utf-8").read()
    d = json.loads(text[text.index("push(") + 5:text.rindex(");")])
    f = {name: i for i, name in enumerate(d["fields"])}
    col = lambda k: [r[f[k]] for r in d["rows"]]
    return {"lat": col("lat"), "lon": col("lon"), "speed_mps": [v / 2.2369362921 for v in col("speed_mph")], "lon_g": col("lon_g"),
            "lat_g": col("lat_g"), "corners": [{"start": int(round(e["start_m"] / 5)), "end": int(round(e["end_m"] / 5)), "apex": e["index"],
                                                "apex_mps": e["apex_mph"] / 2.2369362921} for e in d["events"] if e["type"] == "corner"]}


def test_corner_spread_is_sensor_noise_proof_but_sees_real_variation():
    from core import drive_analysis as da
    if not os.path.exists("web/data/dry_ridge.js"):
        pytest.skip("no shipped drive data")
    base = _dry_ridge_pass()
    n = len(base["lat"])
    for seed in range(4):
        # the same driving four times, seen through realistic noise: ~4 m of smoothed GPS jitter, 0.02 g, 0.15 m/s
        rng = np.random.default_rng(seed)
        ps = []
        for _ in range(4):
            jx, jy = (np.convolve(rng.normal(0, 4, n), np.ones(9) / 9, "same") for _ in range(2))
            ps.append({**base, "lat": list(np.array(base["lat"]) + jy / 110540), "lon": list(np.array(base["lon"]) + jx / (111320 * 0.774)),
                       "lon_g": list(np.array(base["lon_g"]) + rng.normal(0, 0.02, n)), "speed_mps": list(np.array(base["speed_mps"]) + rng.normal(0, 0.15, n))})
        sp = [c["spread"] for c in da.coach(ps[0], ps[1:])["corners"] if c.get("spread")]
        assert all(x["brake_sd_m"] is None or x["brake_sd_m"] < 10 for x in sp), seed    # never flagged as erratic (10 m)
        assert all(x["min_sd_m"] is None or x["min_sd_m"] < 10 for x in sp), seed
        assert sum(x["brake_sd_m"] is not None for x in sp) >= 3
    # two of four passes braking 30 m (6 bins) earlier everywhere: a real spread
    early = dict(base, lon_g=base["lon_g"][6:] + base["lon_g"][-6:])
    sp = [c["spread"]["brake_sd_m"] for c in da.coach(base, [base, early, early])["corners"] if c.get("spread") and c["spread"]["brake_sd_m"] is not None]
    assert sp and max(sp) >= 20


def test_corner_marks_take_this_corners_braking_and_one_dip():
    from core import drive_analysis as da
    n = 80
    lon = [0.0] * n
    for q in range(42, 48):
        lon[q] = -0.6                     # hard braking for the corner before, inside this corner's 200 m lookback
    for q in range(66, 71):
        lon[q] = -0.3                     # this corner's own, lighter braking
    d = {"lon_g": lon, "speed_mps": [20.0] * n}
    onset, slow = da._marks(d, 60, 79, 72)
    assert 64 <= onset <= 66                                   # this corner's braking run, not the harder one before it
    d2 = {"lon_g": lon, "speed_mps": [20.0] * 70 + [15.0, 15.0, 19.0, 19.0, 19.0, 19.0, 15.1, 15.0, 19.0, 20.0]}
    assert da._marks(d2, 60, 79, 72)[1] == 71                  # a double dip: the first minimum's own bins, not the gap between
    flat = {"lon_g": lon, "speed_mps": [18.6, 18.5, 18.3, 18.2, 18.2, 18.3, 18.3, 18.3, 18.3, 18.4, 18.4, 18.8, 19.1] * 7}
    assert da._marks(flat, 2, 14, 5)[1] is None                # a plateau, not a dip: no slowest point
