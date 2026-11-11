"""When to go (web/when_to_go.js): the same route scored for every departure of the next day with the route engine's own
model, on a real Open-Meteo answer for Cincinnati (fetched 2026-11-03, rain on 4 Nov) and the NOAA sun. An eastbound
drive at 7 am on a school day is into the sunrise and through the school run; mid-morning is neither. A forecast that
isn't known is never the reason; a road closed now says when it opens."""
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
globalThis.ApexCore = require(root + '/web/apex_core.js');
globalThis.ApexSun = require(root + '/web/sun.js');
globalThis.ApexFunRoute = require(root + '/web/fun_route.js');
const Ctx = require(root + '/web/route_ctx/registry.js');
globalThis.ApexRouteCtx = Ctx;
require(root + '/web/route_engine.js');
require(root + '/web/route_ctx/conditions.js'); require(root + '/web/route_ctx/wildlife.js');
const W = require(root + '/web/when_to_go.js');
const json = require(root + '/tests/fixtures/route_ctx/openmeteo_cincinnati_2026-11-03.json');
const line = [[39.0930, -84.5250], [39.0955, -84.5040], [39.1040, -84.4700], [39.0900, -84.4450], [39.0600, -84.4250], [39.0500, -84.4150], [39.0300, -84.3500], [38.9900, -84.3000]];
const coords = line.map(([la, lo]) => [lo, la]);
// a 25-minute drive east and south-east out of Cincinnati; the plan's context: terrain, forest beside it, a 72 km/h limit
function cand(departAt, o = {}) {
  const c = Ctx.corridor('r', coords, { timeS: 1500, departAt }), n = c.distM.length;
  const fill = (v) => new Float32Array(n).fill(v);
  const ctx = { channels: { elev_m: Float32Array.from(c.distM, (d) => 250 - d * 0.002), forest_share: fill(o.forest == null ? 0.8 : o.forest), speed_limit_kph: fill(72), road_class: fill(4),
      fog_risk: fill(1), wx_hazard: fill(6) },                                    // the plan's hour said fog and ice: another hour must not inherit them
    from: { elev_m: ['dem'], forest_share: ['osm_tiles'], speed_limit_kph: ['router_edges'], road_class: ['router_edges'], fog_risk: ['conditions'], wx_hazard: ['conditions'] },
    spans: [{ fromM: 5000, toM: 5400, kind: 'school', source: 'osm_tiles' }, { fromM: 0, toM: 900, kind: 'ice', source: 'conditions' }, ...(o.spans || [])], points: [] };
  return { corridor: c, ctx, timeS: 1500, fun: null };
}
const good = async () => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
const down = async () => { throw new Error('offline'); };
const est = (ms) => new Date(ms - 5 * 3600e3).toISOString().slice(11, 16);
const slim = (s) => s && ({ at: s.at, hour: s.hour, value: +s.value.toFixed(2), parts: s.parts, hard: s.hard, glareMin: s.glareMin, dark: s.dark, wx: s.wx, wxKnown: s.wxKnown, waking: s.waking, pens: s.penalties.map((p) => p.label) });
(async () => {
  const out = {};
  const run = async (now, o = {}, fetchFn = good) => {
    const sc = await W.scan(cand(now, o), { now, providerOpts: { fetchFn, storage: null, now } });
    const a = W.advice(sc, { time: est });
    return { n: sc.slots.length, forecast: sc.forecast, status: sc.status, now: slim(sc.now), advice: a && { kind: a.kind, text: a.text, slot: slim(a.slot) }, slots: sc.slots.map(slim),
      said: W.reasons(sc.now), heights: W.heights(sc) };
  };
  const tue7 = Date.UTC(2026, 10, 3, 12, 0);                                     // Tuesday 7:00 am EST, sunrise 7:06
  out.morning = await run(tue7);
  out.offline = await run(tue7, {}, down);
  out.closed = await run(Date.UTC(2026, 10, 3, 15, 0), { forest: 0, spans: [{ fromM: 9000, toM: 9200, kind: 'closure', label: 'Closed for the parade', source: 'osm_overpass', when: { windows: [[Date.UTC(2026, 10, 3, 14, 0), Date.UTC(2026, 10, 3, 17, 0)]] } }] });
  out.beforeRain = await run(Date.UTC(2026, 10, 4, 3, 0), { forest: 0 });        // 10 pm Tuesday; rain from midnight
  out.times = W.slotTimes(Date.UTC(2026, 10, 3, 12, 7), {}).map((t) => new Date(t).toISOString().slice(11, 16)).slice(0, 4);
  const base = { channels: { a: new Float32Array([1, 2]), fog_risk: new Float32Array([1, 1]), mixed: new Float32Array([5, 6]) }, from: { a: ['osm_tiles'], fog_risk: ['conditions'], mixed: ['conditions', 'osm_tiles'] },
    spans: [{ fromM: 0, toM: 1, kind: 'school', source: 'osm_tiles' }, { fromM: 0, toM: 1, kind: 'fog', source: 'conditions' }], points: [{ atM: 0, kind: 'deer-crossing', source: 'wildlife' }] };
  const ov = (timed) => { const r = W.overlay(base, timed, W.TIMED, new Set(['fog_risk', 'light'])); return { ch: Object.fromEntries(Object.entries(r.channels).map(([k, v]) => [k, Array.from(v, (x) => (Number.isNaN(x) ? null : x))])), spans: r.spans.map((s) => s.kind), points: r.points.length }; };
  out.overlayNone = ov(null);
  out.overlay = ov({ channels: { fog_risk: new Float32Array([0, NaN]), mixed: new Float32Array([NaN, 9]) }, spans: [{ fromM: 0, toM: 1, kind: 'glare' }], points: [] });
  console.log(JSON.stringify(out));
})();
"""


@pytest.fixture(scope="module")
def r():
    out = subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-3000:]
    return json.loads(out.stdout)


def test_departures_are_now_then_each_half_hour_for_a_day(r):
    assert r["times"] == ["12:07", "12:30", "13:00", "13:30"]            # 12:07 itself, never a slot within 10 min of it
    assert r["morning"]["n"] == 49
    assert r["morning"]["slots"][0]["at"] == r["morning"]["now"]["at"]


def test_seven_am_eastbound_is_into_the_sun_and_the_school_run(r):
    now = r["morning"]["now"]
    assert now["glareMin"] > 5                                            # 25 min east at sunrise
    assert "school zone" in now["pens"]
    assert now["parts"]["glare"] < -5
    assert "6 min into a low sun" in r["morning"]["said"] and "school run" in r["morning"]["said"]


def test_mid_morning_is_better_and_says_why(r):
    a = r["morning"]["advice"]
    assert a["kind"] == "better"
    assert 9.5 <= a["slot"]["hour"] <= 13.5                               # after the sun is up and the run is over, before the afternoon one
    assert a["slot"]["glareMin"] == 0 and "school zone" not in a["slot"]["pens"]
    assert a["text"].startswith("Better at ")
    assert "no low sun ahead" in a["text"] and "no school run" in a["text"]
    assert a["slot"]["value"] - r["morning"]["now"]["value"] >= 3


def test_the_plans_hour_is_never_inherited(r):
    # the plan's context said fog and ice everywhere (for its own hour); the forecast for each departure replaces it
    assert all("ice" not in s["wx"] for s in r["morning"]["slots"])
    assert "ice" not in r["morning"]["now"]["pens"]
    assert r["overlayNone"]["ch"] == {"a": [1, 2], "mixed": [5, 6]}       # a timed channel with no answer is unknown, not the old hour's
    assert r["overlayNone"]["spans"] == ["school"] and r["overlayNone"]["points"] == 0
    assert r["overlay"]["ch"]["fog_risk"] == [0, None]
    assert r["overlay"]["ch"]["mixed"] == [5, 9]                          # this hour's value first, the map's under it
    assert r["overlay"]["spans"] == ["school", "glare"]


def test_scenery_in_the_dark_is_not_seen(r):
    night = [s for s in r["morning"]["slots"] if s["dark"] == 1]
    day = [s for s in r["morning"]["slots"] if s["dark"] == 0]
    assert night and day
    assert all(s["parts"]["daylight"] < -1 for s in night)                # forest beside the road counts by daylight
    assert all(s["parts"]["daylight"] == 0 for s in day)


def test_the_best_time_is_one_you_would_be_up_for(r):
    for k in ("morning", "beforeRain", "offline"):
        a = r[k]["advice"]
        if a["kind"] == "better":
            assert a["slot"]["waking"] and 6 <= a["slot"]["hour"] <= 22


def test_no_forecast_is_said_and_never_the_reason(r):
    o = r["offline"]
    assert o["forecast"] is False
    assert all(s["wx"] == {} and s["wxKnown"] == 0 for s in o["slots"])
    assert all(s["parts"]["weather"] == 0 for s in o["slots"])
    assert o["now"]["glareMin"] > 5                                       # the sun needs no network
    assert o["advice"]["kind"] == "better" and "rain" not in o["advice"]["text"] and "dry" not in o["advice"]["text"]
    assert "dry" not in o["said"]


def test_closed_now_says_when_it_opens(r):
    a = r["closed"]["advice"]
    assert r["closed"]["now"]["hard"] == ["Closed for the parade"]
    assert a["kind"] == "closed"
    assert a["text"] == "Closed for the parade if you leave now. Open from 12:00."   # the window ends 12:00 EST; the closure is 8 min in
    assert a["slot"]["hard"] == []
    assert r["closed"]["heights"][0] == 0                                  # the ribbon shows a closed departure as no bar


def test_rain_coming_says_leave_by(r):
    a = r["beforeRain"]["advice"]
    assert r["beforeRain"]["now"]["wx"] == {}
    assert a["kind"] == "by"
    assert "rain likely after" in a["text"]
    assert a["text"].startswith("Leave by ") or a["text"].startswith("Go now")
    assert a["slot"]["wx"].get("rain", 0) < 0.15                          # the departure it names is still dry


def test_ribbon_heights_follow_the_value(r):
    h, slots = r["morning"]["heights"], r["morning"]["slots"]
    best = max(range(len(slots)), key=lambda i: slots[i]["value"])
    assert h[best] == 1 and min(h) >= 0.15
    assert all(0 <= x <= 1 for x in h)


def test_the_page_loads_the_sun_and_the_forecast_words_before_the_providers_that_take_them():
    """conditions.js, wildlife.js and hazards_live.js read ApexSun (and ApexRouteWeather) once, as they load: after them in
    the page (as it was), the app's routes had no light, glare, deer hour or forecast hazard per sample at all."""
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    at = lambda name: html.index('<script src="%s"' % name)
    for provider in ("route_ctx/conditions.js", "route_ctx/wildlife.js", "route_ctx/hazards_live.js"):
        assert at("sun.js") < at(provider)
    assert at("route_weather.js") < at("route_ctx/conditions.js")
    assert at("route_ctx/registry.js") < at("when_to_go.js") and at("route_engine.js") < at("when_to_go.js")
