"""web/crew_voice.js (REVIEW.md 5.1, Factory): the WAV a crew's regroup line is uploaded as, which convoy is the crew's,
and what everyone hears on a regroup without a crew line."""
import json
import shutil
import struct
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="needs node")


def run(js: str):
    src = f"const V = require({json.dumps(str(ROOT / 'web' / 'crew_voice.js'))}); console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)


@needs_node
def test_wav_header_and_samples():
    raw = bytes(run("Array.from(V.wav(new Float32Array([0, 1, -1, 0.5]), 24000))"))
    assert raw[:4] == b"RIFF" and raw[8:12] == b"WAVE" and raw[36:40] == b"data"
    assert struct.unpack("<IHHII", raw[16:32]) == (16, 1, 1, 24000, 48000)
    assert struct.unpack("<4h", raw[44:]) == (0, 32767, -32768, 16383)


@needs_node
def test_the_convoy_that_is_the_crews():
    crews = "[{ id: 'k1', name: 'Ridge Runners', call_sign: 'RIDGE' }, { id: 'k2', name: 'Sunday Club', call_sign: null }]"
    assert run(f"V.crewOf('RIDGE · Dawn run', {crews}).id") == "k1"
    assert run(f"V.crewOf('Sunday Club · Coffee', {crews}).id") == "k2"
    assert run(f"V.crewOf('Convoy', {crews})") is None
    assert run(f"V.crewOf('', {crews})") is None


@needs_node
def test_plain_regroup_line():
    assert run("[V.regroupText({ note: 'the overlook' }), V.regroupText({}), V.regroupText(null)]") == ["Regroup at the overlook.", "Regroup point set.", "Regroup point set."]


def test_the_app_never_renders_a_voice():
    src = (ROOT / "web" / "voice.js").read_text()
    assert "async function renderLine" in src and "if (IN_APP || !(await warmLive())) return null;" in src
