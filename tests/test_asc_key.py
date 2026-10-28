"""tools/write_asc_key.sh rebuilds the App Store Connect .p8 from however the secret form stored it."""
import base64
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "write_asc_key.sh"

pytestmark = pytest.mark.skipif(shutil.which("openssl") is None, reason="needs openssl")


def _run(value, out):
    return subprocess.run(["bash", str(SCRIPT), str(out)], env={**os.environ, "ASC_KEY_P8": value},
                          capture_output=True, text=True)


def _der(path):
    return subprocess.run(["openssl", "pkey", "-in", str(path), "-outform", "DER"], capture_output=True, check=True).stdout


@pytest.fixture
def p8(tmp_path):
    key = tmp_path / "key.p8"
    subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", str(key)],
                   check=True, capture_output=True)
    return key


def test_every_pasted_form_gives_the_same_key(p8, tmp_path):
    text = p8.read_text()
    body = "".join(line for line in text.splitlines() if not line.startswith("-----"))
    forms = {
        "as pasted": text,
        "line breaks lost": text.replace("\n", " "),
        "body only": body,
        "base64 of the file": base64.b64encode(text.encode()).decode(),
    }
    for name, value in forms.items():
        out = tmp_path / "out.p8"
        result = _run(value, out)
        assert result.returncode == 0, (name, result.stderr)
        lines = out.read_text().splitlines()
        assert lines[0] == "-----BEGIN PRIVATE KEY-----" and lines[-1] == "-----END PRIVATE KEY-----", name
        assert all(len(line) <= 64 for line in lines[1:-1]), name
        assert _der(out) == _der(p8), name


def test_garbage_fails_clearly(tmp_path):
    result = _run("not a key", tmp_path / "out.p8")
    assert result.returncode != 0
    assert "not a valid private key" in result.stderr
