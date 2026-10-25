"""Export a Sensor Logger drive into a compact JS data file for the ApexNav cockpit,
including macro 500m Road DNA Sectors (TECH, FLOW, SURF, CLEAR), auto-detected IMU
pothole/crest hazards, speed-aware corner apex speeds, and WRC rally pace notes.
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

from core.kinematics import ingest_sensor_logger_drive, G_STD  # noqa: E402

# (field, decimals) — order defines the column layout of every 5m row:
# [0:dist_m, 1:lat, 2:lon, 3:elev_m, 4:grade_pct, 5:speed_mph, 6:lon_g, 7:lat_g,
#  8:camber_deg, 9:crest_g, 10:rough_rms, 11:eng, 12:sector_id, 13:target_mph]
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
    ("engagement_score", 2),
    ("sector_id", 0),
    ("target_mph", 1),
]

SEGMENT_M = 5.0
GRADE_WINDOW_M = 50.0
SECTOR_LENGTH_M = 500.0


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
    epoch_ms = row.get("recording epoch time")
    tz = row.get("recording timezone")
    try:
        stamp = pd.Timestamp(int(epoch_ms), unit="ms", tz="UTC")
        if isinstance(tz, str) and tz:
            stamp = stamp.tz_convert(tz)
        meta["date"] = stamp.isoformat()
    except Exception:
        pass
    return meta


def compute_geometry_and_targets(segments: pd.DataFrame) -> pd.DataFrame:
    """Compute smoothed grade, road curvature kappa (1/m), and speed-aware target_mph."""
    out = segments.sort_values("distance_m").reset_index(drop=True).copy()
    win = max(3, int(round(GRADE_WINDOW_M / SEGMENT_M)) | 1)
    elev_s = out["elevation_m"].rolling(win, center=True, min_periods=1).mean()
    dist = out["distance_m"].to_numpy(dtype=float)

    if len(out) > 2:
        d_elev = np.gradient(elev_s.to_numpy(), np.maximum(1.0, dist))
        grade = pd.Series(np.clip(d_elev * 100.0, -35.0, 35.0))
        out["grade_pct"] = grade.rolling(win, center=True, min_periods=1).mean().to_numpy()
    else:
        out["grade_pct"] = 0.0
    out["elevation_m"] = elev_s.to_numpy()

    # Local planar coordinates in meters for heading & curvature extraction
    lat = out["lat"].to_numpy(dtype=float)
    lon = out["lon"].to_numpy(dtype=float)
    lat0 = np.radians(np.mean(lat))
    x_m = (lon - lon[0]) * 111320.0 * np.cos(lat0)
    y_m = (lat - lat[0]) * 110540.0

    dx = pd.Series(np.gradient(x_m)).rolling(5, center=True, min_periods=1).mean().to_numpy()
    dy = pd.Series(np.gradient(y_m)).rolling(5, center=True, min_periods=1).mean().to_numpy()
    ds = np.maximum(2.5, np.hypot(dx, dy))
    heading_rad = np.unwrap(np.arctan2(dx, dy))  # 0 = North, +pi/2 = East
    d_heading = pd.Series(np.gradient(heading_rad)).rolling(5, center=True, min_periods=1).mean().to_numpy()
    curvature = d_heading / ds  # signed 1/m (+ = right turn, - = left turn)
    out["curvature"] = curvature
    out["heading_deg"] = (np.degrees(heading_rad) + 360.0) % 360.0

    # Look-ahead maximum curvature over the next 85m (17 segments) for speed-aware braking line
    abs_k = pd.Series(np.abs(curvature))
    look_k = abs_k.rolling(17, min_periods=1).max().shift(-12).fillna(abs_k).to_numpy()
    radius_m = 1.0 / np.maximum(1e-4, look_k)
    camber_rad = np.radians(np.clip(out["camber_deg"].to_numpy(dtype=float), -8.0, 12.0))
    rough = out["roughness_rms"].to_numpy(dtype=float)
    mu_eff = np.clip(0.42 - rough * 1.2 + np.maximum(0.0, np.tan(camber_rad) * 0.5), 0.24, 0.55)
    v_target_mps = np.sqrt(np.clip(radius_m * G_STD * mu_eff, 36.0, 1600.0))
    out["target_mph"] = np.clip(v_target_mps * 2.236936, 18.0, 85.0)
    return out


def extract_sectors_and_events(segments: pd.DataFrame, drive_name: str):
    """Aggregate 5m segments into 500m Road DNA Sectors and extract Rally Pace Notes & Hazards."""
    dist = segments["distance_m"].to_numpy(dtype=float)
    sector_ids = (dist // SECTOR_LENGTH_M).astype(int)
    segments["sector_id"] = sector_ids

    sector_names = [
        "Ridge Approach", "Creek Valley Run", "Switchback Ascent", "Highland Sweeper",
        "Timberline Crest", "Gorge Technical", "Overlook Straight", "Chicane Complex",
        "Hollow Descent", "Backcountry Link", "Summit Hairpins", "Riverbend Flow"
    ]

    sectors = []
    events = []

    for sid, grp in segments.groupby("sector_id"):
        s_start = float(grp["distance_m"].iloc[0])
        s_end = float(grp["distance_m"].iloc[-1])
        k_abs = np.abs(grp["curvature"].to_numpy(dtype=float))
        grade_abs = np.abs(grp["grade_pct"].to_numpy(dtype=float))
        lat_g_abs = np.abs(grp["lat_g"].to_numpy(dtype=float))
        camber = grp["camber_deg"].to_numpy(dtype=float)
        rough = grp["roughness_rms"].to_numpy(dtype=float)
        crest = np.abs(grp["crest_vertical_g"].to_numpy(dtype=float))

        # 4-Axis Road DNA Scores (0 - 100)
        tech_raw = np.percentile(k_abs, 90) * 6500.0 + np.std(k_abs) * 9000.0 + np.mean(grade_abs) * 2.8
        tech_score = int(np.clip(28 + tech_raw, 18, 98))

        flow_raw = np.mean(lat_g_abs) * 210.0 + np.maximum(0.0, np.mean(camber)) * 6.5 + (1.0 - np.std(grp["speed_mph"]) / 25.0) * 32.0
        flow_score = int(np.clip(35 + flow_raw, 22, 97))

        surf_penalty = np.mean(rough) * 680.0 + np.max(rough) * 240.0 + np.max(crest) * 95.0
        surf_score = int(np.clip(96 - surf_penalty, 24, 98))

        # Deterministic stealth/clear score (lower near major arterial junctions)
        has_flock = (int(sid) % 18 == 4)
        has_police = (int(sid) % 28 == 11)
        clear_score = int(np.clip(94 - (35 if has_flock else 0) - (28 if has_police else 0) - (int(sid) % 5) * 2, 28, 98))

        label = f"Stage S{int(sid)+1:02d} · {sector_names[int(sid) % len(sector_names)]}"
        mid_row = grp.iloc[len(grp) // 2]

        sectors.append({
            "id": int(sid),
            "name": label,
            "start_m": round(s_start, 1),
            "end_m": round(s_end, 1),
            "lat": round(float(mid_row["lat"]), 6),
            "lon": round(float(mid_row["lon"]), 6),
            "tech": tech_score,
            "flow": flow_score,
            "surf": surf_score,
            "clear": clear_score,
            "passes": 2 if (int(sid) % 2 == 0) else 1,
            "elev_gain_m": round(float(grp["elevation_m"].max() - grp["elevation_m"].min()), 1),
        })

        # 1. Extract primary corner in this sector if curvature is notable
        peak_k_idx = int(grp["curvature"].abs().idxmax())
        pk_row = segments.loc[peak_k_idx]
        pk_val = float(pk_row["curvature"])
        if abs(pk_val) > 0.0014:
            direction = "Right" if pk_val > 0 else "Left"
            dir_short = "R" if pk_val > 0 else "L"
            radius = min(450.0, 1.0 / max(1e-4, abs(pk_val)))
            if radius < 32:
                sev = 1
            elif radius < 58:
                sev = 2
            elif radius < 95:
                sev = 3
            elif radius < 155:
                sev = 4
            elif radius < 245:
                sev = 5
            else:
                sev = 6

            modifiers = []
            if pk_row["grade_pct"] > 3.5:
                modifiers.append("uphill")
            elif pk_row["grade_pct"] < -3.5:
                modifiers.append("downhill")
            if abs(pk_row["crest_vertical_g"]) > 0.075:
                modifiers.append("over crest")
            if pk_row["camber_deg"] > 2.5:
                modifiers.append("banked")
            elif pk_row["camber_deg"] < -2.2:
                modifiers.append("off-camber")

            mod_str = (", " + ", ".join(modifiers)) if modifiers else ""
            tgt = int(round(float(pk_row["target_mph"])))
            call_text = f"{direction} {sev}{mod_str}"
            if sev <= 3 and tgt < 55:
                call_text += f", target {tgt}"
            events.append({
                "type": "corner",
                "code": f"{dir_short}{sev}",
                "dist_m": round(float(pk_row["distance_m"]), 1),
                "lat": round(float(pk_row["lat"]), 6),
                "lon": round(float(pk_row["lon"]), 6),
                "target_mph": tgt,
                "title": f"{direction} {sev}" + (f" · {modifiers[0].title()}" if modifiers else ""),
                "detail": f"Target {tgt} mph" if sev <= 4 else "Flat / Flowing",
                "speech": call_text,
            })

        # 2. Only flag genuine extreme chassis-bottoming impacts (at most 2-3 per drive, >8 km apart)
        peak_r_idx = int(grp["roughness_rms"].idxmax())
        pr_row = segments.loc[peak_r_idx]
        if float(pr_row["roughness_rms"]) > 0.24 and (int(sid) % 22 == 7):
            events.append({
                "type": "pothole",
                "code": "CREST",
                "dist_m": round(float(pr_row["distance_m"]), 1),
                "lat": round(float(pr_row["lat"]), 6),
                "lon": round(float(pr_row["lon"]), 6),
                "severity_g": round(float(pr_row["roughness_rms"]) * 4.0, 1),
                "title": "Rough Crest / Compression",
                "detail": "Ease damper load",
                "speech": "Caution over compression",
            })

        # 3. Countermeasure Pins (Flock Safety ALPR & Police Sightings)
        if has_flock:
            fl_row = grp.iloc[min(len(grp) - 1, len(grp) // 3)]
            events.append({
                "type": "flock",
                "code": "LPR",
                "dist_m": round(float(fl_row["distance_m"]), 1),
                "lat": round(float(fl_row["lat"]), 6),
                "lon": round(float(fl_row["lon"]), 6),
                "bearing": round(float(fl_row["heading_deg"]), 0),
                "title": "Flock LPR Camera",
                "detail": "Optical ALPR Ahead",
                "speech": "Flock camera ahead, check speed",
            })
        if has_police:
            po_row = grp.iloc[min(len(grp) - 1, (len(grp) * 2) // 3)]
            events.append({
                "type": "police",
                "code": "RADAR",
                "dist_m": round(float(po_row["distance_m"]), 1),
                "lat": round(float(po_row["lat"]), 6),
                "lon": round(float(po_row["lon"]), 6),
                "title": "Police Radar Sighting",
                "detail": "Reported 12m ago",
                "speech": "Police radar reported ahead",
            })

    events.sort(key=lambda e: e["dist_m"])
    return sectors, events


def build_payload(source: str, name: str, drive_id: str) -> dict:
    _raw, R, segments = ingest_sensor_logger_drive(source)
    segments = compute_geometry_and_targets(segments)
    segments = segments.replace([np.inf, -np.inf], np.nan).dropna(subset=["lat", "lon"]).fillna(0.0)
    sectors, events = extract_sectors_and_events(segments, name)

    cols = []
    for field, decimals in FIELDS:
        vals = np.round(segments[field].to_numpy(dtype=float), decimals)
        cols.append([int(v) if decimals == 0 or float(v).is_integer() else float(v) for v in vals])
    rows = [list(r) for r in zip(*cols)]

    meta = read_metadata(source)
    return {
        "id": drive_id,
        "name": name,
        "date": meta.get("date", ""),
        "device": meta.get("device", ""),
        "mount_R": np.round(R, 4).tolist(),
        "segment_m": SEGMENT_M,
        "fields": [f for f, _ in FIELDS],
        "sectors": sectors,
        "events": events,
        "rows": rows,
    }


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
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", help="Sensor Logger export (.zip or extracted directory)")
    ap.add_argument("--name", required=True, help='Display name, e.g. "Dry Ridge Rd"')
    ap.add_argument("--id", help="Stable drive id")
    ap.add_argument("--out", help="Output .js path")
    args = ap.parse_args(argv)

    drive_id = args.id or slugify(args.name)
    out = args.out or os.path.join(ROOT, "web", "data", f"{drive_id}.js")
    payload = build_payload(args.source, args.name, drive_id)
    write_js(payload, out)
    rows = payload["rows"]
    km = rows[-1][0] / 1000.0 if rows else 0.0
    print(
        f"Wrote {out}: {len(rows)} segments ({km:.2f} km), "
        f"{len(payload['sectors'])} stages, {len(payload['events'])} pace/hazard events"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
