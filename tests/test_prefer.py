"""web/prefer.js (REVIEW.md 3.3, the plan sheet's Prefer stamps): the share of a route on a set of roads, and the fun
points the stamped preferences give; plan presets keep the stamps."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="needs node")


def run(js: str, mod: str = "prefer.js"):
    src = f"const P = require({json.dumps(str(ROOT / 'web' / mod))}); console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run([NODE, "-e", src], capture_output=True, text=True, check=True).stdout)


LINE = "(n, lat0, dlat) => ({ lat: Array.from({ length: n }, (_, i) => lat0 + i * dlat), lon: Array.from({ length: n }, () => -84.29) })"


@needs_node
def test_share_on_a_set_of_roads():
    js = f"(() => {{ const L = {LINE}; const driven = P.grid([L(200, 35.30, 0.0001)]);" \
         " return [P.share(L(200, 35.30, 0.0001), driven), P.share(L(200, 35.40, 0.0001), driven), P.share(L(400, 35.30, 0.0001), driven)]; })()"
    same, other, half = run(js)
    assert same == 1 and other == 0 and 0.45 < half < 0.55
    assert run("P.share({ lat: [], lon: [] }, new Set(['1:1']))") is None
    assert run(f"P.share(({LINE})(10, 35, 0.001), new Set())") is None
    # [lon, lat] lists (shared routes) work too
    assert run(f"P.share(({LINE})(50, 35.3, 0.0001), P.grid([[[-84.29, 35.3], [-84.29, 35.3025], [-84.29, 35.305]]]))") > 0


@needs_node
def test_bonus_only_for_stamped_and_known():
    f = "{ measured: 0.5, driven: 0.25, crew: 1 }"
    assert run(f"P.bonus({{ measured: true }}, {f})") == 3
    assert run(f"P.bonus({{ novel: true }}, {f})") == 4.5
    assert run(f"P.bonus({{ crew: true }}, {f})") == 6
    assert run(f"P.bonus({{ measured: true, novel: true, crew: true }}, {f})") == 13.5
    assert run(f"P.bonus({{}}, {f})") == 0
    assert run("P.bonus({ measured: true, novel: true, crew: true }, { measured: null, driven: null, crew: null })") == 0


@needs_node
def test_presets_keep_the_prefer_stamps():
    js = """(() => { const m = new Map(); const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
      P.save(st, { name: 'New roads', fun: 'fun', avoid: {}, prefs: { tight: 0, fast: 0, novel: true } });
      return [P.list(st)[0].prefs, !!P.matching(st, { fun: 'fun', avoid: {}, prefs: { tight: 0, fast: 0, novel: true } }),
              !!P.matching(st, { fun: 'fun', avoid: {}, prefs: { tight: 0, fast: 0 } })]; })()"""
    prefs, hit, miss = run(js, "plan_presets.js")
    assert prefs == {"tight": 0, "fast": 0, "measured": False, "novel": True, "crew": False}
    assert hit is True and miss is False
