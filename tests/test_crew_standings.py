"""Crews this month (web/crew_standings.js, IDEAS S-11/S-08): your crews with their totals and rank, the top public crews by
road data and by smoothness; private crews never ranked."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const S = require(process.argv[1] + '/web/crew_standings.js');
const st = { mine: [{ name: 'Ridge Runners', km: 160, smoothness: 85, visibility: 'public', km_rank: 2, smooth_rank: 1, of: 2 },
                    { name: 'Secret', km: 12, smoothness: null, visibility: 'private', km_rank: null, smooth_rank: null, of: 2 },
                    { name: 'Duo', km: 5, smoothness: null, visibility: 'public', km_rank: null, smooth_rank: null, of: 2 }],
             top_km: [{ name: 'Hollow Crew', km: 440 }, { name: 'Ridge Runners', km: 160 }], top_smooth: [{ name: 'Ridge Runners', smoothness: 85 }] };
console.log(JSON.stringify({ l: S.lines(st), empty: S.lines(null) }));
"""


def test_lines():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["l"]["mine"] == ["Ridge Runners · 160 km of road data · Smooth 85 · #2 of 2 for road data, #1 for smoothness",
                                "Secret · 12 km of road data · private, not ranked", "Duo · 5 km of road data · ranked from 3 members"]
    assert out["l"]["km"] == ["1. Hollow Crew · 440 km", "2. Ridge Runners · 160 km"]
    assert out["l"]["smooth"] == ["1. Ridge Runners · Smooth 85"]
    assert out["empty"] == {"mine": [], "km": [], "smooth": []}
