"""Route context, the driver (web/route_ctx/driver.js): passenger aboard (hairpins, quick left-rights, lateral load), the
skill trend from the driver's own drives, lit roads after dark, cyclist courtesy and tunnels, per 25 m sample; the four
settings have one home each (vocabulary.js) and Passenger aboard tags the drive."""
import json
import math
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="needs node")

PRE = f"""
const W = {json.dumps(str(ROOT / 'web'))} + '/';
const D = require(W + 'route_ctx/driver.js'), Sun = require(W + 'sun.js');
const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v instanceof Float32Array || v instanceof Float64Array || v instanceof Uint8Array ? Array.from(v, (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 'NaN')) : v)));
const M_LAT = 110540, mLon = (lat) => 111320 * Math.cos(lat * Math.PI / 180);
// a corridor from a list of headings (deg, clockwise from north), one per 25 m step
const path = (heads, start = '2026-11-07T10:00:00', kmh = 60, id = 'c1') => {{
  const n = heads.length + 1, lat = new Float64Array(n), lon = new Float64Array(n), distM = new Float64Array(n), etaAt = new Float64Array(n);
  lat[0] = 35.5; lon[0] = -83.5; etaAt[0] = Date.parse(start);
  for (let i = 1; i < n; i++) {{ const h = heads[i - 1] * Math.PI / 180; lat[i] = lat[i - 1] + 25 * Math.cos(h) / M_LAT; lon[i] = lon[i - 1] + 25 * Math.sin(h) / mLon(lat[i - 1]);
    distM[i] = distM[i - 1] + 25; etaAt[i] = etaAt[i - 1] + 25 / (kmh / 3.6) * 1000; }}
  return {{ id, lat, lon, distM, etaAt, heading: new Float32Array(n), bbox: [35.4, -83.6, 35.6, -83.4] }};
}};
const straight = (n) => Array(n).fill(0);
"""


def straight(n):
    return [0] * n


def run(js: str):
    p = subprocess.run([NODE, "-e", PRE + f"(async () => {{ const out = await ({js}); console.log(JSON.stringify(clean(out))); }})();"],
                       capture_output=True, text=True, timeout=60, env={**os.environ, "TZ": "America/New_York"})   # the driver's local time
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_settings_have_one_home_and_are_kept():
    out = run("""(() => { const m = new Map(), st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
      const a = D.load(st); D.save(st, { passenger: true, tunnels: 1, bogus: true });
      return { a, b: D.load(st), raw: JSON.parse(m.get('apex.driverPrefs')), tags: [D.driveTags(D.load(st)), D.driveTags(a)] }; })()""")
    assert out["a"] == {"passenger": False, "lit": False, "cyclists": False, "tunnels": False}
    assert out["b"] == {"passenger": True, "lit": False, "cyclists": False, "tunnels": True} and "bogus" not in out["raw"]
    assert out["tags"] == [["Passenger"], []]
    html = (ROOT / "web" / "index.html").read_text()
    for k in ("passenger", "lit", "cyclists", "tunnels"):
        assert html.count(f'data-driver="{k}"') == 1, k
    voc = json.loads(subprocess.run([NODE, "-e", "console.log(JSON.stringify(require(process.argv[1]).TERMS))", str(ROOT / "web" / "vocabulary.js")],
                                    capture_output=True, text=True, check=True).stdout)
    assert {voc[k]["control"] for k in ("passenger", "litRoads", "cyclists", "tunnels")} == {f'data-driver="{k}"' for k in ("passenger", "lit", "cyclists", "tunnels")}


def test_passenger_cost_sees_hairpins_quick_left_rights_and_load():
    # 20 straight, a hairpin (180 deg over 4 steps), 20 straight, a quick left-right, 20 straight
    hair = straight(20) + [45, 90, 135, 180] + [180] * 20
    lr = [180] * 4 + [140, 140, 180, 220, 220, 180] + [180] * 20
    out = run(f"""(() => {{ const g = D.geometryChannels(path({json.dumps(hair + lr)}));
      return {{ cost: g.passenger_cost, hair: g.hairpin, abrupt: g.abrupt, tech: g.tech_level }}; }})()""")
    cost = out["cost"]
    assert max(cost[19:26]) == 1                                      # the hairpin
    assert max(cost[48:58]) >= 0.6                                    # the quick left-right
    assert cost[5] == 0 and cost[40] == 0                             # straight road
    assert sum(out["hair"]) > 0 and sum(out["abrupt"]) > 0
    assert max(out["tech"]) > 0 and out["tech"][-1] < max(out["tech"])


def test_lateral_load_needs_the_router_timing():
    # a steady 15 deg turn per 25 m (radius ~95 m): at 80 km/h ~0.5 g, harsh; at 30 km/h under 0.1 g, nothing
    bend = straight(5) + [i * 15 for i in range(1, 7)] + [90] * 10
    out = run(f"""(() => [D.geometryChannels(path({json.dumps(bend)}, undefined, 80)).passenger_cost, D.geometryChannels(path({json.dumps(bend)}, undefined, 30)).passenger_cost,
      D.geometryChannels({{ ...path({json.dumps(bend)}), etaAt: undefined }}).passenger_cost])()""")
    fast, slow, untimed = out
    assert max(fast[6:11]) == 1 and max(slow[6:11]) == 0 and max(untimed) == 0


def test_skill_trend_from_the_log_and_what_it_offers():
    js = """(() => {
      const d = (k, sm, br, c = 8) => ({ date: `2026-10-${String(k + 1).padStart(2, '0')}`, ds: { corners: c, components: { smoothness: sm, braking: br } } });
      const learner = Array.from({ length: 8 }, (_, k) => d(k, 0.45 + k * 0.03, 0.45 + k * 0.03));
      const expert = Array.from({ length: 8 }, (_, k) => d(k, 0.92, 0.9));
      const few = learner.slice(0, 4), noCorners = Array.from({ length: 8 }, (_, k) => d(k, 0.9, 0.9, 2));
      return { learner: D.skillTrend(learner), expert: D.skillTrend(expert), few: D.skillTrend(few), none: D.skillTrend(noCorners),
               fit: [D.skillFit(0.2, 0.2), D.skillFit(1, 0), D.skillFit(NaN, 0.5)], line: D.skillLine(D.skillTrend(learner)) };
    })()"""
    out = run(js)
    assert out["few"] is None and out["none"] is None
    assert out["learner"]["trend"] > 0 and out["learner"]["offer"] < out["expert"]["offer"]
    assert out["expert"]["offer"] == 1 and out["learner"]["drives"] == 8
    assert out["fit"][0] == 1 and out["fit"][1] == -1 and out["fit"][2] is None
    assert "8 drives" in out["line"] and "smoother" in out["line"]


def test_driver_fit_applies_only_the_preferences_that_are_on():
    hair = straight(20) + [45, 90, 135, 180] + [180] * 20
    js = f"""(() => {{
      const t = path({json.dumps(hair)});
      const off = D.channelsFor(t, {{ prefs: {{}} }}), on = D.channelsFor(t, {{ prefs: {{ passenger: true }} }});
      return {{ off: off.channels.driver_fit, on: on.channels.driver_fit, spans: on.spans.map((s) => s.kind), offSpans: off.spans.length }};
    }})()"""
    out = run(js)
    assert all(v == "NaN" for v in out["off"])                        # nothing on and no skill: nothing to say
    assert min(out["on"]) == -1 and out["on"][5] == 0
    assert "hairpin" in out["spans"] and out["offSpans"] == 0


def test_osm_parse_lit_tunnel_cycle_and_dark_at_eta():
    osm = {"elements": [
        {"type": "way", "id": 1, "tags": {"highway": "tertiary", "lit": "no"}, "geometry": [{"lat": 35.5, "lon": -83.5}, {"lat": 35.504, "lon": -83.5}]},
        {"type": "way", "id": 2, "tags": {"highway": "tertiary", "tunnel": "yes", "lit": "yes"}, "geometry": [{"lat": 35.5045, "lon": -83.5}, {"lat": 35.505, "lon": -83.5}]},
        {"type": "way", "id": 3, "geometry": [{"lat": 35.5, "lon": -83.5}, {"lat": 35.501, "lon": -83.5}]},
        {"type": "node", "id": 4, "lat": 1, "lon": 1}]}
    js = f"""(() => {{
      const feats = D.parseOsm({json.dumps(osm)}), grids = D.gridsOf(feats);
      const night = path(straight(30), '2026-11-07T23:00:00-05:00'), day = path(straight(30), '2026-11-07T10:00:00-05:00');
      const prefs = {{ lit: true, cyclists: true, tunnels: true }};
      const n = D.channelsFor(night, {{ prefs, grids, isDark: Sun.isDark }}), d = D.channelsFor(day, {{ prefs, grids, isDark: Sun.isDark }});
      const blind = D.channelsFor(night, {{ prefs, grids: null, isDark: Sun.isDark }});
      return {{ kinds: feats.map((f) => f.kind), n: n.channels, d: d.channels, spans: n.spans.map((s) => s.kind), pts: n.points.map((p) => p.kind), blind: blind.channels }};
    }})()"""
    out = run(js)
    assert out["kinds"] == ["lit", "lit", "tunnel", "cycle"]
    n, d = out["n"], out["d"]
    assert n["dark"][0] == 1 and d["dark"][0] == 0
    assert n["lit"][2] == 0 and n["lit"][21] == 1 and n["lit"][28] == "NaN"   # untagged: unknown, never "unlit"
    assert n["tunnel"][21] == 1 and n["tunnel"][5] == 0 and n["cyclist_route"][1] == 1 and n["cyclist_route"][20] == 0
    assert d["cyclist_time"][0] == 1 and n["cyclist_time"][0] == 0.2     # Saturday morning vs night
    assert n["driver_fit"][2] < 0 and n["driver_fit"][21] > 0 and d["driver_fit"][2] <= 0
    assert "unlit_dark" in out["spans"] and "tunnel" in out["spans"] and "tunnel" in out["pts"]
    assert all(v == "NaN" for v in out["blind"]["lit"]) and all(v == "NaN" for v in out["blind"]["tunnel"])


def test_query_is_tiles_only_and_provider_never_blocks():
    js = """(async () => {
      const t = path(straight(40));
      const q = D.query(D.tilesOf([t]));
      const t0 = Date.now(), m = new Map(), st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
      const r = await D.provider.fetch([t], { prefs: { lit: true }, fetch: () => new Promise(() => {}), storage: st, budgetMs: 800 });
      const quiet = await D.provider.fetch([t], { prefs: {}, fetch: () => { throw new Error('asked'); }, storage: st });
      return { q, tiles: D.tilesOf([t]), status: r.c1.status, note: r.c1.note, ms: Date.now() - t0, quiet: quiet.c1.status };
    })()"""
    out = run(js)
    assert out["tiles"] == ["355_-835"] and "35.5000,-83.5000,35.6000,-83.4000" in out["q"]
    assert "35.5," not in out["q"].replace("35.5000", "")              # boxes only, never a route point
    assert out["status"] == "partial" and "lighting" in out["note"] and out["ms"] < 3000
    assert out["quiet"] == "ok"                                       # no OSM preference on: nothing fetched



def test_real_overpass_answer_fort_pitt_tunnel():
    """A real Overpass answer for the driver query (Fort Pitt Tunnel, Pittsburgh): the tunnel ways, lit=24/7 counts as lit."""
    fx = ROOT / "tests" / "fixtures" / "route_ctx" / "overpass_driver_fort_pitt_tunnel.json"
    out = run(f"(() => {{ const f = D.parseOsm({fx.read_text()}); return f.map((x) => [x.kind, x.value]); }})()")
    assert out.count(["tunnel", 1]) == 3 and out.count(["lit", 1]) == 2 and ["lit", 0] not in out
