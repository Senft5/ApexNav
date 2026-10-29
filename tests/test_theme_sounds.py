"""Theme sounds (web/theme_sounds.js, docs/design/REVIEW.md 4.2/4.3): each theme its own key and pre-call sound, and
the pre-hazard two-tone identical in every theme (a theme can't change what a hazard sounds like)."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const S = require(process.argv[1] + '/web/theme_sounds.js');
const ids = ['roadbook', 'tapedeck', 'billet', 'nonsense', '__proto__'];
console.log(JSON.stringify({ ids, key: ids.map((i) => S.recipe(i, 'key')), pre: ids.map((i) => S.recipe(i, 'pre')),
  hazard: ids.map((i) => S.recipe(i, 'hazard')), len: S.length(S.recipe('billet', 'pre')), themes: Object.keys(S.RECIPES) }));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_each_theme_has_its_own_key_and_pre_call(out):
    keys, pres = out["key"], out["pre"]
    assert len({json.dumps(k) for k in keys[:3]}) == 3 and len({json.dumps(p) for p in pres[:3]}) == 3
    assert keys[3] == keys[0] and keys[4] == keys[0]                 # unknown: the road book's
    assert out["len"] == pytest.approx(0.12)


def test_the_hazard_sound_is_the_same_everywhere(out):
    assert all(h == out["hazard"][0] for h in out["hazard"]) and len(out["hazard"][0]) == 2


def test_every_theme_has_sounds():
    themes = open(os.path.join(ROOT, "web", "themes.js"), encoding="utf-8").read()
    sounds = open(os.path.join(ROOT, "web", "theme_sounds.js"), encoding="utf-8").read()
    for tid in ("roadbook", "tapedeck", "billet"):
        assert f"id: '{tid}'" in themes and f"{tid}: {{ key:" in sounds
