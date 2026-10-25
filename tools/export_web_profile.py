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
import os
import re
import sys
import zipfile

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

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
    seg["target_mph"] = rd.braking_envelope_mps(kappa, ds, camber, rough) * rd.MPS_TO_MPH
    # Manoeuvres at walking pace (driveways, parking) are not road character.
    speed_mps = seg["speed_mph"].to_numpy(float) / rd.MPS_TO_MPH
    corners = [c for c in rd.detect_corners(kappa, ds, camber, crest, rough)
               if speed_mps[c["apex"]] >= MIN_CORNER_SPEED_MPS]
    hazards = rd.detect_hazards(dist, crest, rough, peak)

    alpr_counts = None
    if alpr_nodes is not None:
        alpr_counts = rd.alpr_counts_by_sector(lat, lon, (dist // rd.SECTOR_LENGTH_M).astype(int), alpr_nodes)
    sectors = rd.score_sectors(dist, kappa, corners, seg["grade_pct"].to_numpy(float), camber,
                               speed_mps, rough, hazards, alpr_counts)
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


def build_payload(seg: pd.DataFrame, meta: dict, alpr_nodes=None) -> dict:
    seg = seg.replace([np.inf, -np.inf], np.nan).dropna(subset=["lat", "lon"]).fillna(0.0)
    seg, sectors, events = profile_segments(seg, alpr_nodes)
    fields = [(f, d) for f, d in FIELDS if f in seg.columns]
    cols = []
    for field, decimals in fields:
        vals = np.round(seg[field].to_numpy(dtype=float), decimals)
        cols.append([int(v) if float(v).is_integer() else float(v) for v in vals])
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

    payload = build_payload(seg, meta, alpr)
    write_js(payload, out)
    kinds = pd.Series([e["type"] for e in payload["events"]]).value_counts().to_dict()
    km = payload["rows"][-1][0] / 1000.0 if payload["rows"] else 0.0
    print(f"Wrote {out}: {len(payload['rows'])} segments ({km:.2f} km), "
          f"{len(payload['sectors'])} sectors, events {kinds}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
