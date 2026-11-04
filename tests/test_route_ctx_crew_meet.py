"""Fair meeting points for crew drives (web/route_ctx/crew_meet.js; backend crew_meet.ts, tested in backend/test): Home's
0.1-degree cell is the most that leaves the phone, and the pick minimises the longest drive first, then the mean."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="needs node")
PRE = f"const M = require({json.dumps(str(ROOT / 'web' / 'route_ctx' / 'crew_meet.js'))});\n"


def run(js: str):
    p = subprocess.run([NODE, "-e", PRE + f"(async () => {{ const out = await ({js}); console.log(JSON.stringify(out)); }})();"],
                       capture_output=True, text=True, timeout=30)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_cell_matches_the_server_and_needs_a_home_pin():
    out = run("[M.cellOf(35.96123, -83.92071), M.cellOf(-0.04, 0.04), M.cellOf(NaN, 1), M.homeCell([{ name: 'Work', lat: 36, lon: -84 }]),"
              " M.homeCell([{ name: 'Work', lat: 36, lon: -84 }, { name: 'home', lat: 35.96123, lon: -83.92071 }])]")
    assert out[0] == {"lat": 35.95, "lon": -83.95} and out[1] == {"lat": -0.05, "lon": 0.05}   # backend cellOf: "35.95,-83.95"
    assert out[2] is None and out[3] is None and out[4] == {"lat": 35.95, "lon": -83.95}
    page = (ROOT / "web" / "crew_page.js").read_text()
    assert "M.homeCell(Pin.list(root.localStorage))" in page and "/home`, body)" in page   # the cell, never the pin itself


def test_fair_pick_minimises_the_longest_drive_then_the_mean():
    # three members, three places: A is closest on average but one member drives 70 min; B's worst is 40
    times = [[600, 2400, 3000], [600, 2400, 1800], [4200, 2000, 3600]]
    out = run(f"[M.fairPick({json.dumps(times)}), M.fairPick([[null, 100], [50, null]]), M.fairPick([])]")
    assert out[0]["index"] == 1 and out[0]["maxS"] == 2400
    assert out[1] is None and out[2] is None


def test_candidates_include_the_median_and_extra_places_and_drop_near_duplicates():
    out = run("M.candidates([[35.95, -83.95], [35.95, -83.95], [35.55, -84.25]], [{ lat: 35.7, lon: -84.1, name: 'Stage start' }, { lat: 35.7001, lon: -84.1 }])")
    assert out[0]["name"] == "Stage start" and len(out) == 4               # extra, median, centroid... and one each of the cells
    assert all(isinstance(p["lat"], (int, float)) for p in out)


def test_fair_meet_with_matrix_and_crow_fly_fallback_and_too_few():
    js = """(async () => {
      const cells = [[35.95, -83.95], [35.55, -84.25], [36.05, -84.15]];
      let asked = null;
      const fetch = async (u, o) => { asked = JSON.parse(o.body); return { ok: true, json: async () => ({ sources_to_targets: asked.sources.map((s) => asked.targets.map((t, j) => ({ time: 600 + 300 * Math.abs(j - 1) }))) }) }; };
      const m = await M.fairMeet(cells, { fetch });
      const est = await M.fairMeet(cells, { fetch: async () => ({ ok: false }) });
      return { m, sources: asked.sources, est, few: await M.fairMeet([[35.95, -83.95]], { fetch }) };
    })()"""
    out = run(js)
    assert out["m"]["maxMin"] == 10 and out["m"]["estimated"] is False
    assert out["sources"] == [{"lat": 35.95, "lon": -83.95}, {"lat": 35.55, "lon": -84.25}, {"lat": 36.05, "lon": -84.15}]   # cells, never homes
    assert out["est"]["estimated"] is True and out["est"]["maxMin"] > 0
    assert out["few"] is None


def test_provider_scores_route_starts_for_the_crew():
    js = """(async () => {
      const t = (id, lat) => ({ id, lat: new Float64Array([lat, lat + 0.01]), lon: new Float64Array([-84, -84]), distM: new Float64Array([0, 1100]) });
      const r = await M.provider.fetch([t('a', 35.75), t('b', 36.5)], { crewCells: [[35.95, -83.95], [35.55, -84.25]], fetch: async () => ({ ok: false }) });
      const none = await M.provider.fetch([t('a', 35.75)], {});
      return { a: r.a.points[0], b: r.b.points[0], st: r.a.status, none: none.a.status };
    })()"""
    out = run(js)
    assert out["a"]["kind"] == "crew_start" and out["a"]["value"] < out["b"]["value"] and out["st"] == "partial"
    assert out["none"] == "unavailable"
