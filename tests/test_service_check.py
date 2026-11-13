"""Service check (web/service_check.js, the owner 2026-11-12): every service judged up, slow or down with a short reason,
our router asked for real plans, the report carries no place but the fixed test one."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const S = require(process.argv[1] + '/web/service_check.js');
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (body === 'bad') throw new Error('x'); return body; },
  arrayBuffer: async () => new ArrayBuffer(body) });
const deps = {
  timeoutMs: 400,
  slowMs: 60,
  apiBase: 'https://w.test',
  apiFetch: async (path) => (path === '/api/health' ? res(200, { ok: true, db: true }) : path === '/api/me' ? res(200, { signed_in: true, member: false })
    : path.startsWith('/api/hazards') ? res(500, { error: 'boom' }) : path.startsWith('/api/ctx/osm') ? res(504, { error: 'still_fetching' }) : res(200, {})),
  fetch: async (url, init) => {
    if (url.includes('overpass-api.de')) { await new Promise((r) => setTimeout(r, 150)); return res(200, { elements: [{}, {}] }); }      // up, but slow
    if (url.includes('kumi')) return res(200, { elements: [], remark: 'runtime error: timed out' });
    if (url.includes('coffee')) return new Promise(() => {});                                          // never answers
    if (url.includes('valhalla')) return res(200, { trip: { status: 0 } });
    if (url.includes('openfreemap.org/styles')) return res(200, 'bad');
    if (url.endsWith('/api/graph/v1/index.json')) return res(200, { tiles: { '381_516': {}, '1_1': {} }, build: '2026-46-0a3822dc-gebab6b', built: '2026-11-10' });
    if (url.endsWith('.vgr')) return res(200, 5000);
    if (url.endsWith('/api/cameras/v1/region.json')) return res(200, { tiles: ['156_-339'], cams: [[39.1, -84.5, 'a']] });
    if (url.includes('terrarium')) return res(200, 12);
    throw new TypeError('Load failed');
  },
  plan: async (level) => (level === 'fun' ? { cands: [1, 2], reason: 'ok' } : { cands: [], reason: 'failed', error: 'worker timed out' }),
  loops: async () => { throw new Error('no worker'); },
  cameras: async () => null,
  cameraQuery: (tile) => 'q:' + tile,
};
const seen = [];
const spy = { ...deps, fetch: (u, i) => { seen.push([u, i && i.body]); return deps.fetch(u, i); } };
(async () => {
  const results = await S.run(spy);
  const by = Object.fromEntries(results.map((r) => [r.id, r]));
  console.log(JSON.stringify({ by, ids: results.map((r) => r.id), probes: S.PROBES.map((p) => p.id), summary: S.summary(results),
    report: S.report(results, { ua: 'Mozilla/5.0 (iPhone) ApexNav/1.2 (401)', online: true }), web: S.appOf('Mozilla/5.0'),
    tile: seen.find(([u]) => u.endsWith('.vgr'))[0], camBody: seen.find(([u]) => u.includes('overpass-api'))[1] }));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True, timeout=60).stdout)


def test_every_probe_answers_in_order(out):
    assert out["ids"] == out["probes"] and len(out["ids"]) == len(set(out["ids"])) >= 25


def test_states_and_reasons(out):
    by = out["by"]
    assert by["api"]["state"] == "up" and by["api"]["http"] == 200
    assert by["session"] == {**by["session"], "state": "down", "detail": "signed in, not a member"}
    assert by["hazards"]["state"] == "down" and by["hazards"]["detail"] == "HTTP 500 boom"
    assert by["overpass_de"]["state"] == "slow" and by["overpass_de"]["detail"] == "2 cameras in the test tile"
    assert by["overpass_kumi"]["state"] == "down" and "timed out" in by["overpass_kumi"]["detail"]
    assert by["overpass_coffee"]["state"] == "down" and by["overpass_coffee"]["detail"] == "timed out"
    assert by["map_style"]["detail"] == "not JSON"
    assert by["search"]["state"] == "down" and by["search"]["detail"] == "Load failed"
    assert by["valhalla"]["state"] == "up"
    assert by["cameras_app"]["state"] == "down" and "Camera map offline" in by["cameras_app"]["detail"]
    assert by["cameras_region"] == {**by["cameras_region"], "state": "up", "detail": "1 cameras, 1 tiles"}
    assert by["overpass_vk"]["state"] == "down"
    assert by["osm_relay"] == {**by["osm_relay"], "state": "slow", "http": 504, "detail": "up, but still fetching from Overpass"}
    assert by["terrain"]["state"] == "down" and by["terrain"]["detail"] == "empty tile"


def test_our_router_is_asked_for_real_plans(out):
    by = out["by"]
    assert by["router_fun"]["state"] == "up" and by["router_fun"]["detail"] == "2 routes"
    assert by["router_long"]["state"] == "down" and by["router_long"]["detail"] == "reason failed: worker timed out"
    assert by["router_loop"]["state"] == "down" and by["router_loop"]["detail"] == "no worker"


def test_graph_probes_read_a_real_tile_straight_from_the_worker(out):
    assert out["tile"] == "https://w.test/api/graph/v1/381_516.vgr"            # the test place's tile, not just any
    assert out["by"]["graph_index"]["detail"] == "2 tiles, built 2026-11-10" and out["by"]["graph_tile"]["state"] == "up"


def test_report_has_no_place_and_names_the_build(out):
    r = out["report"]
    assert {k: r[k] for k in ("app", "version", "build", "online")} == {"app": "ios", "version": "1.2", "build": "401", "online": True}
    assert all(set(x) == {"id", "state", "http", "ms", "detail"} for x in r["results"])
    assert out["web"] == {"app": "web", "version": "", "build": ""}
    assert out["camBody"] == "data=" + "q%3A156_-339"
    assert out["summary"].startswith(f"{sum(1 for x in r['results'] if x['state'] == 'up')} up, 2 slow, ")


def test_owner_only_and_lazy():
    cockpit = open(os.path.join(ROOT, "web", "cockpit.js"), encoding="utf-8").read()
    assert "if (me.moderator) accBody.append(serviceCheckSection()" in cockpit
    assert "ops: ['service_check.js']" in open(os.path.join(ROOT, "web", "lazy.js"), encoding="utf-8").read()
    assert 'src="service_check.js"' not in open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()


AWAY = r"""
const S = require(process.argv[1] + '/web/service_check.js');
let away = 0;
const deps = {
  plan: async (level) => { if (level === 'max') away++; return { cands: [], reason: 'failed', error: 'graph router timed out' }; },
  loops: async () => ({ cands: [], reason: 'failed', error: 'graph router timed out' }),
  away: () => away,
};
(async () => {
  const r = await S.run(deps, ['router_fun', 'router_long', 'router_loop']);
  console.log(JSON.stringify(Object.fromEntries(r.map((x) => [x.id, x]))));
})();
"""


def test_a_probe_the_app_was_hidden_through_is_not_judged():
    # Nate's phone locked mid-check: on return the router said "timed out" after 544 s with nothing wrong (2026-11-13)
    by = json.loads(subprocess.run([NODE, "-e", AWAY, ROOT], capture_output=True, text=True, check=True, timeout=60).stdout)
    assert by["router_long"]["state"] == "skip" and "background" in by["router_long"]["detail"]
    assert by["router_fun"]["state"] == "down" and by["router_loop"]["state"] == "down"   # judged as usual while shown


HIDDEN = r"""
const S = require(process.argv[1] + '/web/service_check.js');
const deps = { plan: async () => ({ cands: [1], reason: 'ok' }), loops: async () => ({ cands: [1] }), away: () => 0, hidden: () => true };
S.run(deps, ['router_fun']).then((r) => console.log(JSON.stringify(r[0])));
"""


def test_a_probe_run_while_hidden_the_whole_time_is_not_judged():
    r = json.loads(subprocess.run([NODE, "-e", HIDDEN, ROOT], capture_output=True, text=True, check=True, timeout=60).stdout)
    assert r["state"] == "skip" and "background" in r["detail"]
