#!/usr/bin/env python3
"""The roughness scale (web/roughness.js) from what phones measured, and fitted to roads known to be smooth or broken.

Why: the old cut points (0.22 g and 0.30 g "rough") were above every road bin in production, so nothing was ever rough.
Roughness is the RMS of a cradled phone's vertical acceleration above 8 Hz per 5 m, which reads far below the car body, so
the scale comes from the measured spread: smooth = the smoothest quarter (p25), rough = the roughest tenth (p90), very
rough = the roughest one in a hundred (p99), over bins two or more passes measured.

With ground truth (roads a driver knows are smooth or broken, as OSM way ids) the cut points move to fit it: rough sits
between the known-smooth roads' upper bins and the known-broken roads' lower bins, smooth under the known-smooth roads'
typical bin. The answer is printed; the constants are changed by hand in web/roughness.js, with the reason.

  # the bins, from D1 (the Cloudflare connector or wrangler):
  #   SELECT way_id, n, rough_mean FROM road_bins WHERE rough_mean IS NOT NULL
  python tools/rough_scale.py bins.json [--truth truth.json]
  # truth.json: {"smooth": [way ids], "rough": [way ids]}
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np

MIN_PASSES = 2


def percentile_scale(rows: list[dict], min_passes: int = MIN_PASSES) -> dict:
    """{smooth, rough, very_rough, bins} from the bins' spread (p25, p90, p99 of bins with min_passes or more)."""
    r = np.array([float(x["rough_mean"]) for x in rows if x.get("rough_mean") is not None and int(x.get("n") or 0) >= min_passes])
    if r.size < 50:
        raise ValueError(f"only {r.size} bins with {min_passes}+ passes: too few to read a scale from")
    p25, p90, p99 = np.percentile(r, [25, 90, 99])
    return {"smooth": round(float(p25), 3), "rough": round(float(p90), 3), "very_rough": round(float(p99), 3), "bins": int(r.size)}


def fit_to_truth(rows: list[dict], truth: dict, base: dict) -> dict:
    """The scale moved to fit known roads. rough: midway between the known-smooth roads' p90 bin and the known-broken
    roads' p25 bin (when they don't overlap; when they do, the scale cannot tell them apart and says so). smooth: the
    known-smooth roads' median bin, never above rough. very_rough: the known-broken roads' p75, never under rough."""
    by = {"smooth": [], "rough": []}
    for kind in by:
        ids = set(int(w) for w in truth.get(kind, []))
        by[kind] = [float(x["rough_mean"]) for x in rows if x.get("rough_mean") is not None and int(x["way_id"]) in ids]
    if not by["smooth"] or not by["rough"]:
        return {**base, "fit": "no bins on the known roads: the percentile scale stands"}
    s, b = np.array(by["smooth"]), np.array(by["rough"])
    s90, b25 = float(np.percentile(s, 90)), float(np.percentile(b, 25))
    out = dict(base)
    if b25 <= s90:
        out["fit"] = (f"the known roads overlap (smooth p90 {s90:.3f} g, broken p25 {b25:.3f} g): roughness alone cannot "
                      "tell them apart here, the percentile scale stands")
        return out
    out["rough"] = round((s90 + b25) / 2, 3)
    out["smooth"] = round(min(float(np.median(s)), out["rough"] * 0.75), 3)
    out["very_rough"] = round(max(float(np.percentile(b, 75)), out["rough"] * 1.25), 3)
    out["fit"] = f"fitted to {s.size} bins on known-smooth roads and {b.size} on known-broken ones"
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("bins")
    ap.add_argument("--truth")
    a = ap.parse_args(argv)
    rows = json.load(open(a.bins))
    rows = rows[0]["results"] if isinstance(rows, list) and rows and "results" in rows[0] else rows   # a D1 answer as it comes
    scale = percentile_scale(rows)
    if a.truth:
        scale = fit_to_truth(rows, json.load(open(a.truth)), scale)
    json.dump(scale, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
