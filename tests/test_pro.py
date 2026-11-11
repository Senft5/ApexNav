"""Vetta Pro on the web (web/pro.js, docs/MONETIZATION.md 8, docs/design/REVIEW.md 4.5): looks only, supporter themes and
liveries (the owner, 2026-11-10: Route tuning is free); never a safety feature, an export, road data, routing, something you
made or a privacy control; nobody has it until the shell verifies it."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/pro.js');
const mem = {}, store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
const out = { items: P.ITEMS, kinds: [...P.KINDS] };
out.nobody = [P.has(store, {}), P.has(store, { pro: true }), P.allowed('theme_tapedeck', store, { pro: true }), P.allowed('roadbook', store, {})];
mem[P.ENT_KEY] = JSON.stringify({ verified: false });
out.unverified = P.has(store, { pro: true });
mem[P.ENT_KEY] = JSON.stringify({ verified: true, expiresMs: Date.now() + 1e6 });
out.verified = [P.has(store, { pro: true }), P.has(store, { pro: false }), P.allowed('theme_billet', store, { pro: true })];
mem[P.ENT_KEY] = JSON.stringify({ verified: true, expiresMs: Date.now() - 1 });
out.expired = P.has(store, { pro: true });
out.lines = [P.line('theme_tapedeck', {}), P.line('theme_tapedeck', { pro: true, proOnSale: true }), P.line('nothing', {})];
mem[P.ENT_KEY] = 'null';
out.tuning = [P.allowed('route_tuning', store, {}), P.allowed('route_tuning', store, { pro: true }), P.allowed('route_tuning', store, { pro: true, proOnSale: true }),
  P.tuningOpen({}), P.tuningOpen({ pro: true, proOnSale: true }), P.line('route_tuning', { pro: true, proOnSale: true })];
out.early = [P.allowed('theme_tapedeck', store, {}), P.allowed('theme_billet', store, { pro: true }), P.allowed('livery_club', store, { pro: true }),
  P.allowed('theme_tapedeck', store, { pro: true, proOnSale: true }), P.themesOpen({}), P.themesOpen({ pro: true, proOnSale: true })];
mem[P.ENT_KEY] = JSON.stringify({ verified: true });
out.tuningPro = P.allowed('route_tuning', store, { pro: true, proOnSale: true });
console.log(JSON.stringify(out));
"""

NEVER = ("hazard", "crash", "export", "gpx", "data", "privacy", "zone", "note", "voice", "limit", "sight", "convoy", "report", "score")


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_pro_is_looks_only(out):
    # the owner, 2026-11-10 (red team PH-06/BR-06): Pro is themes and liveries; Route tuning (Pro from 2026-11-09) is free
    assert set(out["kinds"]) == {"theme", "livery"}
    assert "route_tuning" not in out["items"]
    for key, item in out["items"].items():
        assert item["kind"] in out["kinds"], key
        assert not any(w in (key + " " + item["label"]).lower() for w in NEVER), key   # never a safety feature, export or privacy control


def test_nobody_has_it_until_the_shell_verifies_it(out):
    assert out["nobody"] == [False, False, True, True]   # a theme is open in early access (below)
    assert out["unverified"] is False and out["expired"] is False
    assert out["verified"] == [True, False, True]


def test_the_line_is_honest_that_pro_is_not_on_sale(out):
    assert "isn't on sale yet" in out["lines"][0] and "stays free" in out["lines"][0]
    assert out["lines"][1] == "Tapedeck comes with Vetta Pro." and out["lines"][2] is None


def test_themes_are_open_until_pro_goes_on_sale(out):
    # early access (owner 2026-10-29): every theme for everyone; liveries stay Pro; on sale, themes are Pro again
    assert out["early"] == [True, True, False, False, True, False]


def test_route_tuning_is_free_for_everyone(out):
    # with or without Pro, before or after Pro goes on sale
    assert out["tuning"][:5] == [True, True, True, True, True]
    assert out["tuning"][5] is None                                   # nothing to say: it is not a Pro item
    assert out["tuningPro"] is True
