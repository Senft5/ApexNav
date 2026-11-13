"""Wet roads (web/wet_roads.js, note_timing.js setRoad): the place plate's weather for where you are says whether the road
is wet or icy; on those the pace notes come earlier, and unknown weather changes nothing."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const W = require(process.argv[1] + '/web/wet_roads.js'), T = require(process.argv[1] + '/web/note_timing.js');
const P = require(process.argv[1] + '/web/place_plate.js');
const states = {
  dry: W.stateOf('Dry', 12), fog: W.stateOf('Fog', 8), rain: W.stateOf('Rain', 12), drizzle: W.stateOf('Drizzle', 12),
  storm: W.stateOf('Storm', 20), afterRain: W.stateOf('Wet roads', 12), coldRain: W.stateOf('Rain', 0.5), snow: W.stateOf('Snow', -3),
  unknown: W.stateOf(null, 12), noTemp: W.stateOf('Rain'),
  // the owner's 2026-11-04 day: a cloud code and 0 mm now, but rain in the last hours (place_plate.js weather)
  ownersDay: W.stateOf(P.weather({ code: 3, mmNow: 0, mm3h: 5.6 }), 14), plateDry: W.stateOf(P.weather({ code: 1, mmNow: 0, mm3h: 0 }), 14),
};
const v = 25, apex = 12, lead = () => T.leadM({ vMps: v, apexMps: apex, text: 'Left 3', reactionS: 1.2 });
const dry = lead(); T.setRoad(W.road('wet')); const wet = lead(); const wetBrakes = T.needsBrake(13, 12);
T.setRoad(W.road('ice')); const ice = lead(); T.setRoad(W.road('dry')); const back = lead(); T.setRoad(null); const reset = lead();
console.log(JSON.stringify({ states, dry, wet, ice, back, reset, wetBrakes, dryBrakes: T.needsBrake(13, 12), lines: ['wet', 'ice', 'dry', null].map(W.line) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_road_today_from_the_plates_weather(out):
    s = out["states"]
    assert s["dry"] == "dry" and s["fog"] == "dry" and s["plateDry"] == "dry"
    assert s["rain"] == s["drizzle"] == s["storm"] == s["afterRain"] == s["noTemp"] == s["ownersDay"] == "wet"
    assert s["coldRain"] == "ice" and s["snow"] == "ice"
    assert s["unknown"] is None                                          # unknown stays unknown


def test_notes_come_earlier_on_a_wet_or_icy_road_and_the_dry_road_comes_back(out):
    assert out["dry"] < out["wet"] < out["ice"]
    assert out["back"] == out["dry"] and out["reset"] == out["dry"]
    assert out["wetBrakes"] is True and out["dryBrakes"] is False    # 13 m/s into a 12 m/s corner needs braking when wet


def test_said_for_wet_and_ice_only(out):
    assert out["lines"] == ["Wet roads. Notes come earlier.", "Ice risk. Notes come earlier. Go gently.", "", ""]
