"""Export a profiled drive into a compact JS data file for the ApexNav cockpit.

Every number in the output is either measured (IMU / GPS / barometer) or derived from
measurements by core/road_dna.py. Nothing is invented: no placeholder hazards, no
deterministic "camera every N sectors", no made-up sector names. CLEAR stays null
unless real ALPR positions are supplied with --alpr (an OSM/DeFlock JSON export).

  # from a raw Sensor Logger recording
  python tools/export_web_profile.py drive.zip --name "Dry Ridge Rd"
  # re-derive events/sectors for an already exported file (raw log not needed)
  python tools/export_web_profile.py --reprofile web/data/dry_ridge.js
"""
from __future__ import annotations

import argparse
import io
import json
import urllib.request
import os
import re
import sys
import zipfile

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core import reference_lap as rl  # noqa: E402
from core import road_dna as rd  # noqa: E402
from core.kinematics import ingest_sensor_logger_drive  # noqa: E402

# (field, decimals) — column layout of every 5 m row. The cockpit indexes by name.
FIELDS = [
    ("distance_m", 1),
    ("lat", 6),
    ("lon", 6),
    ("elevation_m", 1),
    ("grade_pct", 1),
    ("speed_mph", 1),
    ("lon_g", 3),
    ("lat_g", 3),
    ("camber_deg", 1),
    ("crest_vertical_g", 3),
    ("roughness_rms", 4),
    ("vert_peak_g", 3),
    ("engagement_score", 2),
    ("sight_m", 0),
    ("limit_kph", 0),
    ("target_mph", 1),
]

MIN_CORNER_SPEED_MPS = 2.5

HAZARD_CALLS = {
    "bump": ("BUMP", "Bump"),
    "crest": ("CREST", "Crest"),
    "dip": ("DIP", "Dip"),
}


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_") or "drive"


def read_metadata(source: str) -> dict:
    try:
        if zipfile.is_zipfile(source):
            with zipfile.ZipFile(source) as zf:
                raw = zf.read("Metadata.csv").decode("utf-8", "replace")
        else:
            with open(os.path.join(source, "Metadata.csv"), encoding="utf-8") as f:
                raw = f.read()
        row = pd.read_csv(io.StringIO(raw)).iloc[0].to_dict()
    except Exception:
        return {}
    meta = {"device": str(row.get("device name", "") or "")}
    try:
        stamp = pd.Timestamp(int(row.get("recording epoch time")), unit="ms", tz="UTC")
        tz = row.get("recording timezone")
        if isinstance(tz, str) and tz:
            stamp = stamp.tz_convert(tz)
        meta["date"] = stamp.isoformat()
    except Exception:
        pass
    return meta


VALHALLA = "https://valhalla1.openstreetmap.de/trace_attributes"
LIMIT_STRIDE = 4             # send every 20 m to the map matcher


def posted_limits_kph(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """OSM maxspeed per sample via Valhalla map matching; NaN where unknown.

    Posted limits are shown beside the physics, never blended into it.
    """
    idx = np.unique(np.concatenate([np.arange(0, len(lat), LIMIT_STRIDE), [len(lat) - 1]]))
    body = json.dumps({
        "shape": [{"lat": float(lat[i]), "lon": float(lon[i])} for i in idx],
        "costing": "auto", "shape_match": "map_snap",
        "filters": {"attributes": ["edge.speed_limit", "matched.edge_index"], "action": "include"},
    }).encode()
    req = urllib.request.Request(VALHALLA, data=body, headers={"Content-Type": "application/json",
                                                               "User-Agent": "ApexNav-exporter"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        res = json.load(resp)
    edges = res.get("edges", [])
    sampled = np.full(len(idx), np.nan)
    for k, mp in enumerate(res.get("matched_points", [])):
        e = mp.get("edge_index")
        if e is not None and e < len(edges) and isinstance(edges[e].get("speed_limit"), (int, float)):
            sampled[k] = float(edges[e]["speed_limit"])
    # Hold each matched value forward to the next sample (limits change at signs, not gradually)
    full = np.full(len(lat), np.nan)
    for k, i in enumerate(idx):
        full[i:idx[k + 1] if k + 1 < len(idx) else len(lat)] = sampled[k]
    return full


def load_web_profile(path: str) -> dict:
    text = open(path, encoding="utf-8").read()
    return json.loads(text[text.index("push(") + 5:text.rindex(");")])


def profile_segments(seg: pd.DataFrame, alpr_nodes=None) -> tuple[pd.DataFrame, list, list]:
    """Run road_dna over 5 m segments -> (segments + target_mph, sectors, events)."""
    seg = seg.sort_values("distance_m").reset_index(drop=True)
    lat = seg["lat"].to_numpy(float)
    lon = seg["lon"].to_numpy(float)
    dist = seg["distance_m"].to_numpy(float)
    camber = np.radians(seg["camber_deg"].to_numpy(float))
    crest = seg["crest_vertical_g"].to_numpy(float)
    rough = seg["roughness_rms"].to_numpy(float)
    peak = seg["vert_peak_g"].to_numpy(float) if "vert_peak_g" in seg else None

    kappa, ds = rd.compute_curvature(lat, lon)
    seg["sight_m"] = rd.sight_distance_m(lat, lon, seg["elevation_m"].to_numpy(float))
    seg["target_mph"] = rd.braking_envelope_mps(kappa, ds, camber, rough,
                                                sight_m=seg["sight_m"].to_numpy()) * rd.MPS_TO_MPH
    # Manoeuvres at walking pace (driveways, parking) are not road character.
    speed_mps = seg["speed_mph"].to_numpy(float) / rd.MPS_TO_MPH
    corners = [c for c in rd.detect_corners(kappa, ds, camber, crest, rough)
               if speed_mps[c["apex"]] >= MIN_CORNER_SPEED_MPS]
    # Below walking pace the phone is being handled, not reading the road.
    hazards = [h for h in rd.detect_hazards(dist, crest, rough, peak)
               if speed_mps[h["index"]] >= MIN_CORNER_SPEED_MPS]

    alpr_counts = None
    if alpr_nodes is not None:
        alpr_counts = rd.alpr_counts_by_sector(lat, lon, (dist // rd.SECTOR_LENGTH_M).astype(int), alpr_nodes)
    limit_mps = seg["limit_kph"].to_numpy(float) / 3.6 if "limit_kph" in seg else None
    lap = rl.simulate(kappa, ds, seg["sight_m"].to_numpy(), camber, rough,
                      seg["elevation_m"].to_numpy(float), limit_mps)
    sectors = rd.score_sectors(dist, corners, camber, rough, hazards, lap, seg["sight_m"].to_numpy(),
                               limit_mps, alpr_counts)
    for s in sectors:
        s["start_m"] = round(s["start_m"], 1)
        s["end_m"] = round(s["end_m"], 1)

    def at(i):
        return {"index": int(i), "dist_m": round(float(dist[i]), 1),
                "lat": round(float(lat[i]), 6), "lon": round(float(lon[i]), 6)}

    events = []
    for c in corners:
        code, call = rd.pace_note_text(c)
        events.append({"type": "corner", "code": code, "call": call, **at(c["apex"]),
                       "start_m": round(float(dist[c["start"]]), 1),
                       "end_m": round(float(dist[c["end"]]), 1),
                       "radius_m": round(c["radius_m"], 1),
                       "apex_mph": round(c["apex_mps"] * rd.MPS_TO_MPH, 1)})
    for h in hazards:
        code, call = HAZARD_CALLS[h["type"]]
        events.append({"type": h["type"], "code": code, "call": call, **at(h["index"]),
                       "severity_g": round(h["severity_g"], 3)})
    events.sort(key=lambda e: e["dist_m"])
    return seg, sectors, events


def build_payload(seg: pd.DataFrame, meta: dict, alpr_nodes=None, limits=True) -> dict:
    limit = seg["limit_kph"] if "limit_kph" in seg else None
    seg = seg.drop(columns=["limit_kph"], errors="ignore")
    seg = seg.replace([np.inf, -np.inf], np.nan).dropna(subset=["lat", "lon"]).fillna(0.0)
    if limits:
        try:
            seg["limit_kph"] = posted_limits_kph(seg["lat"].to_numpy(float), seg["lon"].to_numpy(float))
        except Exception as exc:  # network optional: unknown stays unknown
            print(f"posted limits unavailable: {exc}")
    elif limit is not None:
        seg["limit_kph"] = limit.to_numpy()
    seg, sectors, events = profile_segments(seg, alpr_nodes)
    fields = [(f, d) for f, d in FIELDS if f in seg.columns]
    cols = []
    for field, decimals in fields:
        vals = np.round(seg[field].to_numpy(dtype=float), decimals)
        cols.append([None if np.isnan(v) else (int(v) if float(v).is_integer() else float(v)) for v in vals])
    return {
        **meta,
        "segment_m": 5.0,
        "sector_m": rd.SECTOR_LENGTH_M,
        "fields": [f for f, _ in fields],
        "sectors": sectors,
        "events": events,
        "rows": [list(r) for r in zip(*cols)],
    }


def from_sensor_logger(source: str, name: str, drive_id: str) -> tuple[pd.DataFrame, dict]:
    _raw, R, seg = ingest_sensor_logger_drive(source)
    seg["elevation_m"], seg["grade_pct"] = rd.smooth_elevation_and_grade(
        seg["distance_m"].to_numpy(float), seg["elevation_m"].to_numpy(float))
    meta = read_metadata(source)
    return seg, {"id": drive_id, "name": name, "date": meta.get("date", ""),
                 "device": meta.get("device", ""), "mount_R": np.round(R, 4).tolist()}


def from_web_profile(path: str) -> tuple[pd.DataFrame, dict]:
    d = load_web_profile(path)
    seg = pd.DataFrame(d["rows"], columns=d["fields"])
    meta = {k: d[k] for k in ("id", "name", "date", "device", "mount_R") if k in d}
    return seg, meta


def write_js(payload: dict, out_path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    rows = payload.pop("rows")
    head = json.dumps(payload, separators=(",", ":"))[:-1]
    body = ",\n".join(json.dumps(r, separators=(",", ":")) for r in rows)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("// Generated by tools/export_web_profile.py — do not edit by hand.\n")
        f.write("window.APEX_DRIVES = window.APEX_DRIVES || [];\n")
        f.write("window.APEX_DRIVES.push(" + head + ',"rows":[\n' + body + "\n]});\n")
    payload["rows"] = rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", nargs="?", help="Sensor Logger export (.zip or extracted directory)")
    ap.add_argument("--reprofile", metavar="JS", help="Re-derive an existing web/data/*.js in place")
    ap.add_argument("--name", help='Display name, e.g. "Dry Ridge Rd"')
    ap.add_argument("--id", help="Stable drive id")
    ap.add_argument("--out", help="Output .js path")
    ap.add_argument("--no-limits", action="store_true", help="Skip Valhalla posted-limit lookup")
    ap.add_argument("--alpr", help="JSON list of {lat, lon} ALPR cameras (e.g. from OSM/DeFlock)")
    args = ap.parse_args(argv)

    alpr = json.load(open(args.alpr, encoding="utf-8")) if args.alpr else None
    if args.reprofile:
        seg, meta = from_web_profile(args.reprofile)
        out = args.out or args.reprofile
    elif args.source and args.name:
        drive_id = args.id or slugify(args.name)
        seg, meta = from_sensor_logger(args.source, args.name, drive_id)
        out = args.out or os.path.join(ROOT, "web", "data", f"{drive_id}.js")
    else:
        ap.error("give a Sensor Logger source with --name, or --reprofile FILE")

    payload = build_payload(seg, meta, alpr, limits=not args.no_limits)
    write_js(payload, out)
    kinds = pd.Series([e["type"] for e in payload["events"]]).value_counts().to_dict()
    km = payload["rows"][-1][0] / 1000.0 if payload["rows"] else 0.0
    print(f"Wrote {out}: {len(payload['rows'])} segments ({km:.2f} km), "
          f"{len(payload['sectors'])} sectors, events {kinds}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
