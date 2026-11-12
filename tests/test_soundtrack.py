"""The Soundtrack (web/soundtrack.js on web/audio_bus.js; docs/ARCHITECTURE.md section 5): music made by the road, a
generated score in four stems. Its laws: a fixed tempo that nothing can drive up, the same notes from the same seed, the
pad alone when the road is not measured, off until asked for, and never in the way of the co-driver or the Sight alarm."""
import json
import os
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()

RUNNER = r"""
const S = require(process.argv[1] + '/web/soundtrack.js'), B = require(process.argv[1] + '/web/audio_bus.js');
const seeds = [1, 7, 42, 20261110, 4294967295, 0];
const bus = B.create(); let busy; for (let i = 0; i < 300; i++) busy = bus.step(0.1, { lat_g: 0.6, lon_g: 0.1, speed_mps: 15, corners: [] });
console.log(JSON.stringify({
  pieces: seeds.map((s) => S.piece(s)), again: seeds.map((s) => JSON.stringify(S.compose(S.piece(s), 13)) === JSON.stringify(S.compose(S.piece(s), 13))),
  bars: Array.from({ length: 32 }, (_, n) => S.compose(S.piece(42), n)), other: S.compose(S.piece(43), 0),
  tempo: S.TEMPO, bar_s: S.BAR_S, level: S.LEVEL,
  unknown: S.mix(null), nulls: S.mix({ engagement: null, intensity: null, anticipation: null, energy: 0, cutoff_hz: 380, layers: { pad: 1, pulse: 0, bass: 0, lead: 0 }, swell: 0, master: 1 }),
  busy: S.mix(busy), ducked: S.mix(Object.assign({}, busy, { master: B.DUCK })), half: S.mix(busy, 0.5), junk: S.mix({ intensity: 1, layers: { pad: 9, pulse: -3, bass: NaN, lead: 'x' }, cutoff_hz: 1e9, swell: 7, master: 5 }),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_the_same_seed_is_the_same_piece(out):
    assert all(out["again"])
    assert len({json.dumps(p["chords"]) + p["mode"] + str(p["root"]) + json.dumps(p["figure"]) for p in out["pieces"]}) >= 4   # and seeds differ
    assert out["bars"][0] != out["other"]


def test_the_tempo_is_fixed_and_nothing_can_drive_it(out):
    assert out["tempo"] == 92 and out["bar_s"] == pytest.approx(4 * 60 / 92)
    assert all(p["tempo"] == 92 for p in out["pieces"])
    src = read("web", "soundtrack.js")
    code = "\n".join(line.split("//")[0] for line in src.splitlines())
    assert "speed" not in code.lower() and "mph" not in code.lower()         # the engine has no way to hear it
    assert "function compose(p, n)" in src and "function mix(frame, volume = 1)" in src   # the notes take no frame; the mix takes no clock


def test_every_bar_is_written_in_key_and_in_time(out):
    scale = {0, 2, 3, 5, 7, 8, 10}                                           # seed 42 is C aeolian
    for n, bar in enumerate(out["bars"]):
        layers = {e["layer"] for e in bar}
        assert {"pulse", "bass"} <= layers and (("pad" in layers) == (n % 2 == 0))
        for e in bar:
            assert 0 <= e["beat"] < 4 and e["beats"] > 0 and 0 < e["vel"] <= 1
            assert (e["midi"] - 48) % 12 in scale, e
            assert {"pad": 48 <= e["midi"] <= 84, "pulse": 60 <= e["midi"] <= 96, "bass": 28 <= e["midi"] <= 55, "lead": 60 <= e["midi"] <= 100}[e["layer"]], e
    assert sum(1 for bar in out["bars"] for e in bar if e["layer"] == "lead") >= 16     # the lead is sparse, not absent
    assert max(sum(1 for e in bar if e["layer"] == "lead") for bar in out["bars"]) <= 8
    assert out["bars"][0] != out["bars"][8] and [e for e in out["bars"][0] if e["layer"] != "lead"] == [e for e in out["bars"][8] if e["layer"] != "lead"]   # the loop comes round; the lead does not repeat


def test_an_unmeasured_road_plays_the_pad_alone(out):
    for m in (out["unknown"], out["nulls"]):
        assert m["gains"]["pad"] > 0 and m["gains"]["pulse"] == 0 and m["gains"]["bass"] == 0 and m["gains"]["lead"] == 0 and m["riser"] == 0


def test_the_mix_follows_the_bus(out):
    busy, level = out["busy"], out["level"]
    assert busy["gains"]["pulse"] == pytest.approx(level["pulse"]) and busy["gains"]["bass"] > 0.5 * level["bass"] and busy["cutoff_hz"] > 2000
    assert out["ducked"]["master"] == pytest.approx(busy["master"] * 0.35) and out["half"]["master"] == pytest.approx(busy["master"] * 0.5)
    junk = out["junk"]                                                       # whatever it is handed, it stays inside its own levels
    assert junk["gains"]["pad"] == pytest.approx(level["pad"]) and junk["gains"]["pulse"] == 0 and junk["gains"]["bass"] == 0 and junk["gains"]["lead"] == 0
    assert junk["cutoff_hz"] == 12000 and junk["master"] <= 0.85 and junk["riser"] <= 0.05


def test_it_is_off_until_asked_for_and_wired_to_a_drive():
    js, page = read("web", "cockpit.js"), read("web", "index.html")
    assert "soundtrack: false," in js                                        # the default
    assert '<button class="sw" data-toggle="soundtrack"><i></i><span>Soundtrack</span></button>' in page
    assert '<script src="audio_bus.js" defer></script>' in page and '<script src="soundtrack.js" defer></script>' in page
    # TestFlight 2026-11-12 (the owner: "walls of text"): the switch and its sample, no essay; never your speed stays in the code
    assert 'id="soundtrackHear">Hear a sample</button>' in page and "It follows the road, never your speed." not in page
    tick = js[js.index("function soundtrackTick("):js.index("function soundtrackSample(")]
    assert "live && driveActive && !pendingEnd && state.toggles.soundtrack === true" in tick                # only in a drive, only when switched on
    assert "over_sight: Inst.sightShort(d), speaking: !!speech.busy" in tick  # the one alarm and the voice come first
    assert "L.calibration === 'locked'" in tick and "lat_g: g ? d.latG : null" in tick   # g before the mount is set is unknown
    assert "soundtrackTick(d, vMps, !!live);" in js
    sample = js[js.index("function soundtrackSample("):]
    assert "if (state.mode === 'live')" in sample[:900]                      # the made-up road never plays in a drive
    assert re.search(r"Soundtrack.*audio_bus", read("docs", "ARCHITECTURE.md"), re.S)
