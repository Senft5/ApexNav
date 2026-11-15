"""Hazard and DOT pins on the map (web/hazard_reports.js pinView, Nate 2026-11-15): only what is in view, a small mark when
zoomed out, the tag (its words) closer in, the most serious first, never one over another, and a cap on each."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const H = require(process.argv[1] + '/web/hazard_reports.js');
const view = (zoom) => ({ width: 390, height: 700, zoom });
const pin = (id, x, y, kind = 'lane', label = 'LANE CLOSED') => ({ id, x, y, kind, label });
const out = {};
const spread = [pin('in', 100, 100), pin('left', -300, 100), pin('below', 100, 1500), pin('edge', 395, 300)];
out.out = Object.fromEntries(H.pinView(spread, view(9)));
out.near = Object.fromEntries(H.pinView(spread, view(14)));
// two on the same spot: one tag, the other not piled on it; the crash wins over the lane closure
out.pile = Object.fromEntries(H.pinView([pin('lane', 200, 300), pin('crash', 205, 302, 'crash', 'CRASH')], view(14)));
// a dense city: never more than the caps
const many = Array.from({ length: 200 }, (_, i) => pin('p' + i, (i * 37) % 390, (i * 53) % 700));
const zin = [...H.pinView(many, view(14)).values()], zout = [...H.pinView(many, view(9)).values()];
out.capIn = { tags: zin.filter((v) => v === 'tag').length, marks: zin.filter((v) => v === 'mark').length };
out.capOut = { tags: zout.filter((v) => v === 'tag').length, marks: zout.filter((v) => v === 'mark').length };
out.bad = [H.pinView(null, view(9)).size, H.pinView([pin('x', NaN, 1)], view(9)).size, H.pinView(spread, null).size];
out.consts = [H.TAG_ZOOM, H.MAX_TAGS, H.MAX_MARKS];
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_only_what_is_in_view(out):
    assert set(out["out"]) == {"in", "edge"}                     # off the screen: not drawn; just over the edge: kept
    assert set(out["near"]) == {"in", "edge"}


def test_a_mark_zoomed_out_and_a_tag_closer_in(out):
    assert out["out"] == {"in": "mark", "edge": "mark"}
    assert out["near"]["in"] == "tag"


def test_never_one_over_another_the_serious_first(out):
    assert out["pile"] == {"crash": "tag"}


def test_capped(out):
    tag_zoom, max_tags, max_marks = out["consts"]
    assert tag_zoom == 12.5
    assert out["capIn"]["tags"] <= max_tags and out["capIn"]["marks"] <= max_marks
    assert out["capOut"]["tags"] == 0 and 0 < out["capOut"]["marks"] <= max_marks


def test_bad_input_draws_nothing(out):
    assert out["bad"] == [0, 0, 0]


def test_wired_on_the_map():
    js = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert "ApexHazardReports.pinView(" in js and "map.on('move'" in js
    assert ".hz-pin.hz-mini" in html
