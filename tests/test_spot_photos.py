"""Spot photos (web/spot_photos.js, IDEAS S-18): scaled to at most 1600 px, never enlarged; the EXIF scanner finds the
camera's metadata segment (where GPS lives) so the e2e flow can prove a kept photo has none."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/spot_photos.js');
const seg = (m, payload) => [0xFF, m, ((payload.length + 2) >> 8) & 255, (payload.length + 2) & 255, ...payload];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const jpeg = (...segs) => new Uint8Array([0xFF, 0xD8, ...segs.flat(), 0xFF, 0xDA, 0, 2, 1, 2, 3, 0xFF, 0xD9]);
console.log(JSON.stringify({
  big: P.fit(4032, 3024), tall: P.fit(3024, 4032), small: P.fit(800, 600), bad: P.fit(0, 10),
  exif: P.exifSegments(jpeg(seg(0xE0, ascii('JFIF\0')), seg(0xE1, ascii('Exif\0\0MM')))),
  xmp: P.exifSegments(jpeg(seg(0xE1, ascii('http://ns.adobe.com/xap/1.0/\0')))),
  clean: P.exifSegments(jpeg(seg(0xE0, ascii('JFIF\0')), seg(0xDB, [0, 1, 2]))),
  notJpeg: P.exifSegments(new Uint8Array([0x89, 0x50, 0x4E, 0x47])),
}));
"""


def test_spot_photos():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["big"] == {"w": 1600, "h": 1200}
    assert out["tall"] == {"w": 1200, "h": 1600}
    assert out["small"] == {"w": 800, "h": 600}
    assert out["bad"] is None
    assert out["exif"] == ["exif"] and out["xmp"] == ["xmp"]
    assert out["clean"] == [] and out["notJpeg"] == []
