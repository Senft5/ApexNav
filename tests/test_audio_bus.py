"""The audio bus (core/audio_bus.py, its port web/audio_bus.js; docs/ARCHITECTURE.md section 5): what the road asks of
the driver as numbers for a sound engine. Pure; the two are held to one sequence; every frame obeys the contract."""
import json
import math
import os
import shutil
import subprocess

import pytest

from core.audio_bus import AudioBus, CALM_CAP, DUCK, HORIZON_M, severity

NODE = shutil.which("node")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA = json.load(open(os.path.join(ROOT, "schemas", "telemetry_contracts.json"), encoding="utf-8"))
FRAME = SCHEMA["definitions"]["AudioBusFrame"]
KNOWN = {"description", "type", "required", "additionalProperties", "properties", "minimum", "maximum"}
TYPES = {"object": dict, "number": (int, float), "integer": int, "boolean": bool, "string": str, "null": type(None)}


def conform(value, schema, path="frame"):
    """The JSON Schema keywords AudioBusFrame uses, checked by hand (no jsonschema in requirements.txt). A keyword this
    does not know fails loudly, so the contract cannot grow past what is checked."""
    unknown = set(schema) - KNOWN
    assert not unknown, f"{path}: conform() does not check {sorted(unknown)}"
    if "type" in schema:
        kinds = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        ok = any(isinstance(value, TYPES[k]) and not (k in ("number", "integer") and isinstance(value, bool)) for k in kinds)
        assert ok, f"{path}: {value!r} is not {kinds}"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        assert math.isfinite(value), f"{path}: {value!r} is not finite"
        if "minimum" in schema:
            assert value >= schema["minimum"], f"{path}: {value} < {schema['minimum']}"
        if "maximum" in schema:
            assert value <= schema["maximum"], f"{path}: {value} > {schema['maximum']}"
    if isinstance(value, dict):
        for k in schema.get("required", []):
            assert k in value, f"{path}: missing {k}"
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = set(value) - set(props)
            assert not extra, f"{path}: not in the contract: {sorted(extra)}"
        for k, sub in props.items():
            if k in value:
                conform(value[k], sub, f"{path}.{k}")


def test_the_checker_catches_a_frame_that_breaks_the_contract(frames):
    bad = dict(frames[100], cutoff_hz=-1.0)
    with pytest.raises(AssertionError):
        conform(bad, FRAME)
    with pytest.raises(AssertionError):
        conform(dict(frames[100], loudness=1.0), FRAME)


def road():
    """90 s at 10 Hz: the mount not set yet, a straight, two corners with their approaches, a spell over Sight, a spoken
    line, a stop, the look-ahead lost. Deterministic."""
    seq = []
    for k in range(900):
        t = k * 0.1
        v = 0.0 if 60 <= t < 66 else 14.0 + 3.0 * math.sin(t / 7.0)
        first, second = 300.0 - 14.0 * (t - 8.0), 380.0 - 14.0 * (t - 30.0)
        corners = [[a, s] for a, s in ((first, 0.9), (second, None)) if 0 <= a <= 600]
        in_corner = (29.5 <= t < 34) or (57 <= t < 60)
        lat = 0.55 * math.sin((t % 4.5) / 4.5 * math.pi) if in_corner else 0.03 * math.sin(t)
        seq.append({"dt": 0.1 if k else 0.0, "lat_g": None if t < 5 else lat, "lon_g": None if t < 5 else (-0.3 if 27 <= t < 29.5 else 0.02),
                    "speed_mps": None if 70 <= t < 72 else v, "corners": None if t >= 80 else corners,
                    "over_sight": 40 <= t < 46, "speaking": 48 <= t < 51})
    return seq


def run_py(seq):
    bus = AudioBus()
    return [bus.step(s["dt"], s["lat_g"], s["lon_g"], s["speed_mps"], None if s["corners"] is None else [tuple(c) for c in s["corners"]],
                     s["over_sight"], s["speaking"]) for s in seq]


@pytest.fixture(scope="module")
def frames():
    return run_py(road())


def test_every_frame_obeys_the_contract(frames):
    for f in frames:
        conform(f, FRAME)


def test_unknown_stays_unknown(frames):
    # no calibrated g: no workload, and no music acted out; the pad alone
    for f in frames[:50]:
        assert f["engagement"] is None and f["intensity"] is None
        assert f["layers"]["pulse"] == 0 or f["anticipation"]            # only a known corner ahead may stir it
    # the look-ahead lost: no anticipation, no riser
    for f in frames[800:]:
        assert f["anticipation"] is None and f["swell"] == 0
    # the speed unknown: a distance can't be turned into a time
    assert all(f["anticipation"] is None for f in frames[701:719])


def test_it_builds_into_a_corner_and_lets_go_at_its_entry(frames):
    swell = [f["swell"] for f in frames]
    entry = 80 + round(300 / 14 * 10)                                    # the first corner's entry, about t = 29.4 s
    assert swell[entry - 60] < 0.2 < swell[entry - 20] < swell[entry - 3]
    assert all(b >= a - 1e-9 for a, b in zip(swell[entry - 70:entry - 3], swell[entry - 69:entry - 2]))   # it only climbs
    assert swell[entry + 8] < 0.25 * swell[entry - 3]                    # and is gone within a second of the entry
    assert max(swell) <= 1.0


def test_the_stems_cross_in_as_the_road_gets_busier(frames):
    straight, corner = frames[150], max(frames[295:340], key=lambda f: f["energy"])
    assert straight["energy"] < 0.1 and straight["layers"]["pulse"] == 0 and straight["layers"]["lead"] == 0
    assert corner["energy"] > 0.4 and corner["layers"]["pulse"] > 0.9 and corner["layers"]["bass"] > 0.3
    assert corner["cutoff_hz"] > 3 * straight["cutoff_hz"]
    # held like music: after the corner it comes down slowly, not at once
    after = frames[345]
    assert after["engagement"] < 0.1 < after["intensity"]


def test_over_sight_it_steps_back_and_under_the_voice_it_ducks(frames):
    calm = frames[455]                                                   # 5.5 s into the spell over Sight
    assert calm["calm"] and calm["energy"] <= CALM_CAP + 0.01 and calm["layers"]["lead"] == 0 and calm["layers"]["bass"] == 0
    assert frames[505]["master"] < DUCK + 0.02 and frames[560]["master"] > 0.95
    assert not frames[470]["calm"]


def test_speed_is_never_excitement():
    """The same road at 10 and at 40 m/s with no load and no corner ahead: the same rest. Speed alone changes nothing."""
    out = []
    for v in (10.0, 40.0):
        bus, f = AudioBus(), None
        for _ in range(100):
            f = bus.step(0.1, 0.0, 0.0, v, [], False, False)
        out.append(f)
    assert out[0] == out[1] and out[0]["energy"] == 0
    # and a queue is not a build-up: crawling toward a corner stirs nothing
    bus = AudioBus()
    assert all(bus.step(0.1, 0.0, 0.0, 1.5, [(20.0, 1.0)], False, False)["swell"] == 0 for _ in range(50))
    # a corner beyond the horizon is not heard yet
    assert AudioBus().step(0.1, 0.0, 0.0, 60.0, [(HORIZON_M + 1, 1.0)], False, False)["swell"] == 0


def test_severity():
    assert severity(1) == 1.0 and severity(6) == pytest.approx(1 / 6) and severity(None) is None and severity(9) is None


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_port_matches(frames):
    runner = r"""
const B = require(process.argv[1] + '/web/audio_bus.js'), seq = JSON.parse(require('fs').readFileSync(0, 'utf8')), bus = B.create();
console.log(JSON.stringify({ frames: seq.map((s) => bus.step(s.dt, s)), sev: [1, 6, null, 9].map(B.severity) }));
"""
    out = json.loads(subprocess.run([NODE, "-e", runner, ROOT], input=json.dumps(road()), capture_output=True, text=True, check=True).stdout)
    assert out["sev"] == [1, pytest.approx(1 / 6), None, None]
    assert len(out["frames"]) == len(frames)
    for a, b in zip(frames, out["frames"]):
        assert a.keys() == b.keys() and a["calm"] == b["calm"]
        for k in ("engagement", "intensity", "anticipation", "energy", "cutoff_hz", "swell", "master"):
            assert (a[k] is None) == (b[k] is None), k
            assert a[k] is None or a[k] == pytest.approx(b[k], abs=1e-9, rel=1e-9), k
        for k, v in a["layers"].items():
            assert v == pytest.approx(b["layers"][k], abs=1e-9)
