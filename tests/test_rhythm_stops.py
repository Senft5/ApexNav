"""Rhythm (the Driver Score's consistency) judges only the corners whose pace the driver chose (Nate 2026-11-16: public
roads have stop signs, lights and traffic, not a prepped track): a corner with a stop within 100 m before it or 50 m
after it is left out of Rhythm, and still counts for pace, smoothness and braking. core/drive_analysis.py is the
reference, web/apex_core.js its port."""
import json
import math
import os
import shutil
import subprocess

import pytest

from core import drive_analysis as da

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")


def drive(corners, gap_bins=60):
    """corners: [(speed through the corner m/s, stop_before_bins or None, stop_after_bins or None)]; a 18 m/s limit."""
    v, lon, lat, cs = [], [], [], []
    for spd, before, after in corners:
        gap = [20.0] * gap_bins
        if before is not None:
            gap[gap_bins - before - 1] = 0.0                     # stopped `before` bins ahead of the corner's start
        v += gap; lon += [0.0] * gap_bins; lat += [0.0] * gap_bins
        s = len(v)
        for q in range(30):
            v.append(spd); lat.append(0.35 * math.sin(math.pi * q / 29)); lon.append(0.0)
        cs.append({"start": s, "end": s + 29, "apex": s + 15, "apex_mps": 18.0})
        tail = [20.0] * 4
        if after is not None:
            tail = [20.0] * after + [0.0] + [20.0] * 3
        v += tail; lon += [0.0] * len(tail); lat += [0.0] * len(tail)
    v += [20.0] * gap_bins; lon += [0.0] * gap_bins; lat += [0.0] * gap_bins
    return v, lon, lat, cs


def test_a_corner_by_a_stop_is_left_out_of_rhythm_only():
    free = [(15.0, None, None)] * 4
    v, lon, lat, cs = drive(free)
    even = da.driver_score(v, lon, lat, cs)
    assert even["components"]["consistency"] == 1.0
    # the same drive with a slow corner just after a stop sign (50 m before it): Rhythm is still even, the pace not
    v, lon, lat, cs = drive(free + [(6.0, 10, None)])
    s = da.driver_score(v, lon, lat, cs)
    assert da.corner_technique(v, lon, lat, cs[-1])["near_stop"] is True
    assert s["corners"] == 5 and s["components"]["consistency"] == 1.0
    assert s["components"]["pace"] < even["components"]["pace"]
    # ...and a slow corner just before a light (25 m after it)
    v, lon, lat, cs = drive(free + [(6.0, None, 5)])
    assert da.driver_score(v, lon, lat, cs)["components"]["consistency"] == 1.0


def test_a_slow_corner_you_chose_still_counts_and_a_stop_further_away_does_not_excuse_it():
    v, lon, lat, cs = drive([(15.0, None, None)] * 4 + [(6.0, None, None)])
    assert da.driver_score(v, lon, lat, cs)["components"]["consistency"] < 1.0
    v, lon, lat, cs = drive([(15.0, None, None)] * 4 + [(6.0, 30, None)])         # a stop 150 m back: you chose this pace
    assert da.corner_technique(v, lon, lat, cs[-1])["near_stop"] is False
    assert da.driver_score(v, lon, lat, cs)["components"]["consistency"] < 1.0


def test_with_fewer_than_two_chosen_corners_rhythm_takes_them_all():
    v, lon, lat, cs = drive([(15.0, None, None), (6.0, 10, None), (9.0, None, 5)])
    s = da.driver_score(v, lon, lat, cs)
    assert s["components"]["consistency"] < 1.0                                   # never a free 100 out of one corner


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_web_port_matches():
    cases = [drive([(15.0, None, None)] * 4 + [(6.0, 10, None)]), drive([(15.0, None, None)] * 3 + [(6.0, None, 5), (11.0, None, None)]),
             drive([(15.0, None, None), (6.0, 10, None), (9.0, None, 5)]), drive([(14.0, None, None), (6.0, 30, None), (16.0, 2, None)])]
    py = [da.driver_score(*c) for c in cases]
    runner = ("const c=require(process.argv[1]);const cs=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "process.stdout.write(JSON.stringify(cs.map(([v,lo,la,k])=>({s:c.driverScore(v,lo,la,k),"
              "n:k.map(x=>c.cornerTechnique(v,lo,la,x).near_stop)}))));")
    out = subprocess.run([NODE, "-e", runner, os.path.join(ROOT, "web", "apex_core.js")], input=json.dumps(cases),
                         capture_output=True, text=True, check=True)
    for j, p, c in zip(json.loads(out.stdout), py, cases):
        assert j["s"] == p
        assert j["n"] == [da.corner_technique(c[0], c[1], c[2], k)["near_stop"] for k in c[3]]
