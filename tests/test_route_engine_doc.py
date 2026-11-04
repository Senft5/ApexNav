"""docs/ROUTE_ENGINE.md's weights tables and flowchart page match the code: every weight read from web/route_engine.js
and web/fun_route.js, and docs/design/route_engine_flow.html rebuilt from the doc (python3 tools/route_engine_flow.py)."""
import json
import os
import pathlib
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = pathlib.Path(__file__).resolve().parent.parent
DOC = (ROOT / "docs" / "ROUTE_ENGINE.md").read_text()

DUMP = r"""
const root = process.argv[1];
globalThis.ApexCore = require(root + '/web/apex_core.js');
const F = require(root + '/web/fun_route.js'); globalThis.ApexFunRoute = F;
const E = require(root + '/web/route_engine.js');
const spans = Object.fromEntries(Object.entries(E.SPANS).map(([k, r]) => [k, { each: r.each ?? null, perKm: r.perKm ?? null, bonus: r.bonus ?? null,
  bonusPerKm: r.bonusPerKm ?? null, cap: r.bonusCap ?? null, hard: r.hard === true ? 'yes' : typeof r.hard === 'function' ? 'fn' : null }]));
process.stdout.write(JSON.stringify({ W: E.W, perKm: Object.fromEntries(E.PER_KM.map((t) => [t.ch, t.perKm])), spans,
  quality: Object.fromEntries(E.QUALITY.map((t) => [t.ch, t.w])), scenery: Object.fromEntries(E.SCENERY.map((t) => [t.ch, t.w])), levels: F.LEVELS }));
"""


@pytest.fixture(scope="module")
def code():
    res = subprocess.run([NODE, "-e", DUMP, str(ROOT)], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def table(heading_cell):
    """Rows of the markdown table whose header row starts with `| heading_cell |`."""
    lines = DOC.split("\n")
    i = next(k for k, l in enumerate(lines) if l.startswith(f"| {heading_cell} |"))
    rows = []
    for l in lines[i + 2:]:
        if not l.startswith("|"):
            break
        rows.append([c.strip() for c in l.strip().strip("|").split("|")])
    return rows


def num(s):
    return None if s == "" else float(s)


def under(heading):
    """Rows of the first table after a ### heading."""
    part = DOC[DOC.index(heading):]
    lines = part.split("\n")
    i = next(k for k, l in enumerate(lines) if l.startswith("|"))
    rows = []
    for l in lines[i + 2:]:
        if not l.startswith("|"):
            break
        rows.append([c.strip() for c in l.strip().strip("|").split("|")])
    return rows


def test_constants(code):
    doc = {r[0]: float(r[1]) for r in table("constant")}
    assert doc == {k: float(v) for k, v in code["W"].items()}


def test_per_km_penalties(code):
    assert {r[0]: float(r[1]) for r in table("per-km penalty")} == {k: float(v) for k, v in code["perKm"].items()}


def test_spans_and_points(code):
    doc = {r[0]: r[1:] for r in table("span or point")}
    assert set(doc) == set(code["spans"]), set(doc) ^ set(code["spans"])
    for k, r in code["spans"].items():
        each, per_km, bonus, bonus_km, cap, hard = doc[k]
        assert (num(each), num(per_km), num(bonus), num(bonus_km), num(cap)) == (r["each"], r["perKm"], r["bonus"], r["bonusPerKm"], r["cap"]), k
        assert (hard == "yes") == (r["hard"] == "yes") and (hard.startswith("value")) == (r["hard"] == "fn"), k


def test_levels(code):
    doc = {r[0]: (float(r[1]), float(r[2]), float(r[3])) for r in table("level")}
    assert doc == {k: (v["budget"], v["slackS"], v["perMin"]) for k, v in code["levels"].items()}


def test_quality_and_scenery_tables(code):
    q = {r[0].strip("`"): float(r[3]) for r in under("### Quality (weight; goodness)")}
    s = {r[0].strip("`"): float(r[3]) for r in under("### Scenery (weight; goodness)")}
    extra = {"bldg_per_km": 1.0}                          # documented with builder B's names, not in the table
    assert {**q, **extra} == code["quality"], set(q) ^ set(code["quality"])
    assert s == code["scenery"], set(s) ^ set(code["scenery"])


def test_flowchart_is_there_and_the_page_is_current():
    blocks = re.findall(r"```mermaid\n(.*?)```", DOC, re.S)
    assert len(blocks) == 5 and all(b.startswith("flowchart TD") for b in blocks)
    for b in blocks:
        assert b.count('"') % 2 == 0, "a label's quotes are unbalanced"
    r = subprocess.run(["python3", str(ROOT / "tools" / "route_engine_flow.py"), "--check"], capture_output=True)
    assert r.returncode == 0, "docs/design/route_engine_flow.html is stale: python3 tools/route_engine_flow.py"
    page = (ROOT / "docs" / "design" / "route_engine_flow.html").read_text()
    assert "mermaid@10.9.1" in page and "prefers-color-scheme: dark" in page and 'name="viewport"' in page
