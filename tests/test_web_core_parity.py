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
    cases = [(drives[0], [drives[1]]), (drives[1], [drives[0], quick]), (drives[1], [])]
    np_ = lambda d: {**d, "speed_mps": np.array(d["speed_mps"]), "lon_g": np.array(d["lon_g"]), "lat_g": np.array(d["lat_g"])}
    py = [da.coach(np_(a), [np_(o) for o in others]) for a, others in cases]
    runner = ("const c=require(process.argv[1]);const cases=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify(cases.map(([a,o])=>c.coach(a,o))));")
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")], input=json.dumps(cases),
                         capture_output=True, text=True, check=True)
    tips = 0
    for j, p in zip(json.loads(out.stdout), py):
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
            for side in ("m", "best"):
                if cp[side] is not None:
                    for k, v in cp[side].items():
                        assert cj[side][k] == (None if v is None else pytest.approx(v, rel=1e-9, abs=1e-9)), k
    assert tips > 0 and py[1]["clean"] > 0 and py[1]["gain_s"] > 0


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
    py = [(e["code"], e["call"], e["index"], e["link"]) for e in events if e["type"] == "corner"]
    cols = {k: seg[k].tolist() for k in ("distance_m", "lat", "lon", "elevation_m", "speed_mph", "camber_deg",
                                         "crest_vertical_g", "roughness_rms")}
    runner = ("const c=require(process.argv[1]);const cols=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify(c.profileRecording(cols).events.map(e=>[e.code,e.call,e.index])));")
    out = subprocess.run([NODE, "-e", runner, os.path.abspath("web/apex_core.js")], input=json.dumps(cols),
                         capture_output=True, text=True, check=True)
    js = [tuple(j) for j in json.loads(out.stdout)]
    assert js == [p[:3] for p in py]
