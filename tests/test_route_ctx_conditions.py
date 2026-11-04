"""Route context `conditions` (web/route_ctx/conditions.js): Open-Meteo at each sample's eta (a real answer for eight 0.05°
cells around Cincinnati, fetched 2026-11-03 23:5x UTC, past 2 days + 3 ahead), sun and light from web/sun.js, fog in valleys
vs ridges, crosswind against the heading, cold tyres and ice, and the golden-hour view that never rewards glare."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const root = process.argv[1];
const K = require(root + '/web/route_ctx/conditions.js'), C = require(root + '/tests/fixtures/route_ctx/corridor.js');
const json = require(root + '/tests/fixtures/route_ctx/openmeteo_cincinnati_2026-11-03.json');
const r3 = (v) => (Number.isNaN(v) || v === null || v === undefined ? null : Math.round(v * 1000) / 1000);
const arr = (a) => Array.from(a, r3);
const line = [[39.0930, -84.5250], [39.0955, -84.5040], [39.1040, -84.4700], [39.0900, -84.4450], [39.0600, -84.4250], [39.0500, -84.4150], [39.0300, -84.3500], [38.9900, -84.3000]];
const mk = (ms, speed = 20, extra) => C.corridor('r', line, { departAt: ms, speedMps: speed, extra });
const keys = K.plan([mk(0)], null, 0).want, list = K.parse(json);
const series = new Map(keys.map((k, i) => [k, list[i]]));
const first = series.get(require(root + '/web/route_ctx/ctx_util.js').cellOf(line[0][0], line[0][1], K.CELL));   // the route start's cell
const dawn = K.evaluate(mk(Date.UTC(2026, 10, 3, 11, 0)), series);                        // 6 am EST, sunrise 12:06 UTC
const slow = K.evaluate(mk(Date.UTC(2026, 10, 3, 11, 20), 3), series);                     // a slow drive into sunrise
const day = K.evaluate(mk(Date.UTC(2026, 10, 3, 17, 0)), series);
const later = K.evaluate(mk(Date.UTC(2026, 10, 5, 12, 0)), series);                       // after the rain of 4-5 Nov
const beyond = K.evaluate(mk(Date.UTC(2026, 10, 9, 15, 0)), series);                      // past the forecast
// cold morning: the same answer with the temperatures taken down 12 °C (frost at the ground: road under the dew point)
const cold = JSON.parse(JSON.stringify(json));
for (const x of cold) { x.hourly.temperature_2m = x.hourly.temperature_2m.map((t) => t - 12); x.hourly.dew_point_2m = x.hourly.dew_point_2m.map((t) => t - 12); x.hourly.soil_temperature_0cm = x.hourly.dew_point_2m.map((t) => t - 0.5); }
const coldSeries = new Map(keys.map((k, i) => [k, K.parse(cold)[i]]));
const frosty = K.evaluate(mk(Date.UTC(2026, 10, 3, 11, 0)), coldSeries);
// a westbound descent at sunset (2026-11-03, sunset ~22:32 UTC): straight into the sun vs the sun off to the side
const west = [[39.10, -84.40], [39.10, -84.46]], sunward = [[39.10, -84.40], [39.0873, -84.435]];   // due west; bearing 245°, the sun's azimuth at 22:00
const desc = (c) => ({ channels: { [c.id]: { elev_m: Float32Array.from(c.distM, (d) => 300 - d * 0.05) } } });
const wInto = C.corridor('w', sunward, { departAt: Date.UTC(2026, 10, 3, 22, 0) }), wAfter = C.corridor('w2', west, { departAt: Date.UTC(2026, 10, 3, 22, 40) });
const nwLow = C.corridor('nw', west, { departAt: Date.UTC(2026, 10, 3, 21, 55) });       // sun ~6° up, 25° left of the nose
const into = K.evaluate(wInto, series, desc(wInto)), after = K.evaluate(wAfter, series, desc(wAfter)), side = K.evaluate(nwLow, series, desc(nwLow));
const DEG = Math.PI / 180;
console.log(JSON.stringify({
  n: list.length, hours: list[0].t.length, elev: list.map((s) => s.elev),
  url: K.url([[39.025, -84.425]]),
  at: { t11: r3(K.at(first, 'temperature_2m', Date.UTC(2026, 10, 3, 11, 0))), p48: K.precipBefore(first, Date.UTC(2026, 10, 3, 11, 0), 48), s11: r3(K.at(first, 'soil_temperature_0cm', Date.UTC(2026, 10, 3, 11, 0))), t: r3(K.at(list[0], 'temperature_2m', Date.UTC(2026, 10, 3, 11, 30))), wd: K.at(list[0], 'wind_direction_10m', Date.UTC(2026, 10, 3, 11, 30)), out: K.at(list[0], 'temperature_2m', Date.UTC(2026, 10, 9)) },
  dawn: { status: dawn.status, light: [...new Set(arr(dawn.channels.light))], spans: dawn.spans.map((s) => s.kind), air: r3(dawn.channels.air_temp_c[0]), road: r3(dawn.channels.road_temp_c[0]),
    vis: r3(dawn.channels.visibility_m[0]), fog: [...new Set(arr(dawn.channels.fog_risk))], p48: r3(dawn.channels.precip_48h_mm[0]), cross: r3(dawn.channels.crosswind_mps[0]), gust: r3(dawn.channels.gust_mps[0]),
    hazard: [...new Set(arr(dawn.channels.wx_hazard))], golden: [...new Set(arr(dawn.channels.golden_view))], exposure: [...new Set(arr(dawn.channels.exposure))], note: dawn.note },
  slow: [...new Set(arr(slow.channels.light))],
  day: { light: [...new Set(arr(day.channels.light))], spans: day.spans.map((s) => s.kind) },
  later: { p48: Math.max(...arr(later.channels.precip_48h_mm)) },
  beyond: { status: beyond.status, air: [...new Set(arr(beyond.channels.air_temp_c))], light: r3(beyond.channels.light[0]) },
  frosty: frosty.spans.filter((s) => s.kind !== 'dark').map((s) => [s.kind, s.value]),
  golden: { into: [...new Set(arr(into.channels.golden_view))], glare: Math.max(...arr(into.channels.glare)), after: Math.max(...arr(after.channels.golden_view)), side: Math.max(...arr(side.channels.golden_view)), sideGlare: Math.max(...arr(side.channels.glare)), spans: after.spans.map((s) => s.kind) },
  fog: {
    clear: K.fogRisk({ visM: 20000, tempC: 12, dewC: 5, windMps: 4, lowCloud: 0, sunAlt: -0.3 }),
    model: K.fogRisk({ visM: 400, tempC: 5, dewC: 5, windMps: 1, lowCloud: 100, sunAlt: 0.2 }),
    radFlat: K.fogRisk({ visM: 9000, tempC: 6, dewC: 5, windMps: 1, lowCloud: 10, sunAlt: -0.2 }),
    radValley: K.fogRisk({ visM: 9000, tempC: 6, dewC: 5, windMps: 1, lowCloud: 10, sunAlt: -0.2, tpiM: -40 }),
    radRidge: K.fogRisk({ visM: 9000, tempC: 6, dewC: 5, windMps: 1, lowCloud: 10, sunAlt: -0.2, tpiM: 60 }),
    ridgeInCloud: K.fogRisk({ visM: 9000, tempC: 8, dewC: 5, windMps: 5, lowCloud: 95, sunAlt: 0.3, tpiM: 60 }),
    valleyByDem: K.fogRisk({ visM: 9000, tempC: 6, dewC: 5, windMps: 1, lowCloud: 10, sunAlt: -0.2, relM: -80 }),
    unknown: K.fogRisk({}),
  },
  sun: [K.sunFlags(5 * DEG, 270 * DEG, 270 * DEG, -0.05), K.sunFlags(5 * DEG, 230 * DEG, 270 * DEG, -0.05), K.sunFlags(-2 * DEG, 260 * DEG, 270 * DEG, -0.05), K.sunFlags(5 * DEG, 230 * DEG, 270 * DEG, 0.01), K.sunFlags(5 * DEG, 90 * DEG, 270 * DEG, -0.05), K.sunFlags(5 * DEG, 230 * DEG, 270 * DEG, NaN)],
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_parses_the_real_answer(out):
    assert out["n"] == 8 and out["hours"] == 120
    assert all(100 < e < 300 for e in out["elev"])
    assert out["at"]["t"] == pytest.approx(11.6, abs=0.1) and out["at"]["wd"] in (53, 52, 54) and out["at"]["out"] is None
    assert "past_days=2" in out["url"] and "wind_speed_unit=ms" in out["url"] and "latitude=39.025&longitude=-84.425" in out["url"]


def test_dawn_drive_is_dark_mild_and_clear(out):
    d = out["dawn"]
    assert d["light"] == [0] and d["spans"] == ["dark"] and d["status"] == "ok"
    assert d["air"] == out["at"]["t11"] and d["road"] == out["at"]["s11"] and 5 < d["air"] < 20   # the cell's own values at 11:00
    assert d["vis"] > 10000 and d["fog"] == [0] and d["hazard"] == [0]
    assert d["p48"] == out["at"]["p48"] and 0 < d["p48"] < 5       # a dry weekend before
    assert 0 <= d["cross"] <= d["gust"]
    assert d["golden"] == [None] and d["exposure"] == [None] and "no elevation" in d["note"]   # unknown, never 0


def test_each_sample_at_its_own_eta(out):
    assert out["slow"] == [0, 1, 2]                                # a slow drive starts dark, passes civil twilight, ends in day
    assert out["day"]["light"] == [2] and "dark" not in out["day"]["spans"]
    assert out["later"]["p48"] > 25                                # the rain of 4-5 Nov is in the 48 h before
    assert out["beyond"]["status"] == "unavailable" and out["beyond"]["air"] == [None] and out["beyond"]["light"] == 2


def test_cold_tyres_and_frost(out):
    kinds = dict(out["frosty"])
    assert kinds["cold-tyres"] < 7 and "ice" in kinds


def test_golden_view_never_rewards_glare(out):
    g = out["golden"]
    assert g["glare"] == 1 and g["into"] == [0]                    # descending west into the setting sun: glare, no bonus
    assert g["after"] == 1 and "golden-view" in g["spans"]         # just after sunset, facing the glow from above
    assert g["side"] == 1 and g["sideGlare"] == 0                  # low sun 40-50° off the nose on the way down


def test_sun_flags(out):
    into, side, afterglow, climbing, behind, unknown = out["sun"]
    assert into == {"glare": 1, "golden": 0} and side == {"glare": 0, "golden": 1} and afterglow == {"glare": 0, "golden": 1}
    assert climbing == {"glare": 0, "golden": 0} and behind == {"glare": 0, "golden": 0} and unknown == {"glare": 0, "golden": None}


def test_fog_in_valleys_not_on_ridges(out):
    f = out["fog"]
    assert f["clear"] == 0 and f["model"] == 0.8 and f["unknown"] is None
    assert f["radValley"] > f["radFlat"] > f["radRidge"]
    assert f["ridgeInCloud"] == 0.6 and f["valleyByDem"] == f["radValley"]


def test_a_slow_forecast_never_holds_the_plan():
    """Open-Meteo took 2-3.5 s or failed on the live runs and the whole context waited for it: the plan waits 0.8 s at
    most (waitMs here), and the late answer lands in the cache, so the next plan has it with no new request."""
    js = r"""
const root = process.argv[1];
const K = require(root + '/web/route_ctx/conditions.js'), C = require(root + '/tests/fixtures/route_ctx/corridor.js');
const json = require(root + '/tests/fixtures/route_ctx/openmeteo_cincinnati_2026-11-03.json');
const m = new Map(), storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; } };
const line = [[39.0930, -84.5250], [39.0955, -84.5040], [39.1040, -84.4700], [39.0900, -84.4450], [39.0600, -84.4250], [39.0500, -84.4150], [39.0300, -84.3500], [38.9900, -84.3000]];
const c = C.corridor('r', line, { departAt: Date.UTC(2026, 10, 3, 17, 0), speedMps: 20 });
let calls = 0;
const slow = (url) => { calls++; return new Promise((res) => setTimeout(() => res({ ok: true, json: async () => json }), 600)); };
(async () => {
  const t0 = Date.now(), a = await K.provider.fetch([c], { fetchFn: slow, storage, now: Date.UTC(2026, 10, 3, 16, 0), waitMs: 100 });
  const ms = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 800));
  const before = calls, b = await K.provider.fetch([c], { fetchFn: slow, storage, now: Date.UTC(2026, 10, 3, 16, 0), waitMs: 100 });
  console.log(JSON.stringify({ ms, first: a.r.status, second: b.r.status, before, after: calls }));
})();
"""
    out = json.loads(subprocess.run([NODE, "-e", js, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["ms"] < 400 and out["first"] != "ok", out
    assert out["second"] == "ok" and out["after"] == out["before"], out
