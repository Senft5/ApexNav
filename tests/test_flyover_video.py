"""A drive's flyover as a video (web/flyover_video.js, IDEAS D-10): the best type the recorder makes, a clean file name,
an even size within 1280 px."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const V = require(process.argv[1] + '/web/flyover_video.js');
const safari = { isTypeSupported: (t) => t.startsWith('video/mp4') }, chrome = { isTypeSupported: (t) => t.startsWith('video/webm') }, none = { isTypeSupported: () => false };
console.log(JSON.stringify({ safari: V.mimeFor(safari), chrome: V.mimeFor(chrome), none: V.mimeFor(none), missing: V.mimeFor(undefined),
  name: V.fileName('Dry Ridge Rd!', 'video/mp4', new Date('2026-10-28T12:00:00Z')), web: V.fileName('', 'video/webm', new Date('2026-10-28T12:00:00Z')),
  big: V.sizeFor(2340, 1080), small: V.sizeFor(781, 391) }));
"""


def test_helpers():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["safari"] == "video/mp4;codecs=avc1" and out["chrome"] == "video/webm;codecs=vp9" and out["none"] is None and out["missing"] is None
    assert out["name"] == "Dry_Ridge_Rd-2026-10-28.mp4" and out["web"] == "drive-2026-10-28.webm"
    assert out["big"] == {"w": 1280, "h": 590} and out["small"] == {"w": 782, "h": 392}
