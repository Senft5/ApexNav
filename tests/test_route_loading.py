import pathlib
import shutil
import subprocess

import pytest


ROOT = pathlib.Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")


def run_node(script):
    result = subprocess.run(
        [NODE, "-e", script, str(ROOT)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("phase", ["fetch", "json", "arrayBuffer"])
def test_deadline_covers_request_and_body_even_if_abort_is_ignored(phase):
    run_node(r"""
const assert = require('node:assert/strict');
const loading = require(process.argv[1] + '/web/route_loading.js');
globalThis.ApexUnits = require(process.argv[1] + '/web/units.js');
const phase = 'PHASE';
let signal;
global.fetch = async (url, options) => {
  signal = options.signal;
  if (phase === 'fetch') return new Promise(() => {});
  return { ok: true, [phase]: () => new Promise(() => {}) };
};
(async () => {
  const method = phase === 'arrayBuffer' ? phase : 'json';
  await assert.rejects(loading[method]('https://isolated.test', {}, 5), /took too long/);
  assert.equal(signal.aborted, true);
})().catch(error => { console.error(error); process.exitCode = 1; });
""".replace("PHASE", phase))


def test_optional_road_feel_membership_cannot_block_route_selection():
    run_node(r"""
const assert = require('node:assert/strict');
const loading = require(process.argv[1] + '/web/route_loading.js');
(async () => {
  assert.equal(await loading.optional(new Promise(() => {}), 5), null);
  assert.equal(await loading.optional(Promise.reject(Error('offline'))), null);
  const member = { member: true };
  assert.equal(await loading.optional(Promise.resolve(member)), member);
})().catch(error => { console.error(error); process.exitCode = 1; });
""")


def test_success_errors_and_cleanup():
    run_node(r"""
const assert = require('node:assert/strict');
const loading = require(process.argv[1] + '/web/route_loading.js');
(async () => {
  let signal;
  global.fetch = async (url, options) => {
    signal = options.signal;
    assert.equal(options.method, 'POST');
    assert.equal(options.body, 'request');
    return { ok: true, json: async () => ({ value: null }) };
  };
  assert.deepEqual(await loading.json('https://isolated.test', { method: 'POST', body: 'request' }, 5), { value: null });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(signal.aborted, false);
  global.fetch = async () => ({ ok: false, status: 503, json: () => { throw Error('not called'); } });
  await assert.rejects(loading.json('https://isolated.test'), /HTTP 503/);
  global.fetch = async () => ({ ok: true, json: async () => { throw Error('invalid JSON'); } });
  await assert.rejects(loading.json('https://isolated.test'), /invalid JSON/);
  global.fetch = async () => { throw Error('offline'); };
  await assert.rejects(loading.json('https://isolated.test'), /offline/);
  const bytes = new ArrayBuffer(3);
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => bytes });
  assert.equal(await loading.arrayBuffer('https://isolated.test'), bytes);
})().catch(error => { console.error(error); process.exitCode = 1; });
""")


def test_route_analysis_yields_between_existing_core_phases():
    run_node(r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require(process.argv[1] + '/web/apex_core.js');
const loading = require(process.argv[1] + '/web/route_loading.js');
const html = fs.readFileSync(process.argv[1] + '/web/index.html', 'utf8');
const source = html.match(/async function trackFromPolyline\(.*?\n    }/s)[0];
let heartbeat = 0;
const phases = {};
const instrumented = new Proxy(core, {
  get(target, name) {
    if (!['computeCurvature', 'sightDistanceM', 'brakingEnvelopeMps'].includes(name)) return target[name];
    return (...args) => { phases[name] = heartbeat; return target[name](...args); };
  },
});
const build = new Function('Core', 'MPH', 'RouteLoading', 'return (' + source + ')')(instrumented, core.MPS_TO_MPH, loading);
(async () => {
  const timer = setInterval(() => heartbeat++, 0);
  try {
    const coords = Array.from({ length: 401 }, (_, index) => [-84 + index * 0.00005, 39 + Math.sin(index / 20) * 0.0005]);
    const route = await build(coords, 'isolated', 'Isolated route');
    assert.ok(phases.computeCurvature > 0);
    assert.ok(phases.sightDistanceM > phases.computeCurvature);
    assert.ok(phases.brakingEnvelopeMps > phases.sightDistanceM);
    const sampled = core.resamplePolyline(coords.map(point => point[1]), coords.map(point => point[0]), 5);
    const { kappa, ds } = core.computeCurvature(sampled.lat, sampled.lon);
    const sight = core.sightDistanceM(sampled.lat, sampled.lon);
    assert.deepEqual(route.lat, sampled.lat);
    assert.deepEqual(route.sightM, Array.from(sight));
    assert.deepEqual(route.envMps, Array.from(core.brakingEnvelopeMps(kappa, ds, null, null, undefined, sight)));
    assert.equal(route.roughG, null);
    assert.equal(route.camberDeg, null);
    assert.equal(route.kind, 'route');
    assert.ok(!/[^\w]const [tn]t? = trackFromPolyline\(/.test(html));
  } finally { clearInterval(timer); }
})().catch(error => { console.error(error); process.exitCode = 1; });
""")


def test_destination_failure_releases_button_and_loop_can_retry():
    run_node(r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(process.argv[1] + '/web/index.html', 'utf8');
const destinationSource = html.match(/async function routeToQuery\(.*?\n    }/s)[0];
const loopSource = html.match(/async function loop\(.*?\n    }/s)[0];
let completed = 0;
let loopAttempts = 0;
const messages = [];
const button = { value: 'Somewhere', classList: { contains: () => false } };
const busy = () => ({ step() {}, done() { completed++; } });
const destination = new Function('$', 'planBusy', 'toast', 'resolvePlace', 'funRoute', 'return (' + destinationSource + ')')(
  () => button, busy, message => messages.push(message),
  async () => ({ lat: 39, lon: -84, label: 'Place' }),
  async () => { throw Error('service deadline'); },
);
const loop = new Function('busy', 'toast', 'buildLoop', 'document', 'let loopBusy = false; return (' + loopSource + ')')(
  busy, message => messages.push(message),
  async () => { loopAttempts++; throw Error('service deadline'); },
  { querySelectorAll: () => [] },
);
(async () => {
  await destination();
  assert.equal(completed, 1);
  assert.ok(messages.includes('service deadline'));
  await loop(20, button);
  await loop(20, button);
  assert.equal(loopAttempts, 2);
  assert.equal(completed, 3);
})().catch(error => { console.error(error); process.exitCode = 1; });
""")


def test_stalled_primary_router_falls_back_and_awaits_analysis():
    run_node(r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const loading = require(process.argv[1] + '/web/route_loading.js');
globalThis.ApexUnits = require(process.argv[1] + '/web/units.js');
const html = fs.readFileSync(process.argv[1] + '/web/index.html', 'utf8');
const source = html.match(/async function buildRoute\(.*?\n    }/s)[0];
const drives = [];
let analyzed = false;
let activated = null;
let fallbackCalls = 0;
global.fetch = async () => new Promise(() => {});
const build = new Function('valhallaRoutes', 'osrmRoutes', 'trackFromPolyline', 'Core', 'drives', 'activate', 'renderRouteCard', 'state', 'openPlan', 'attachLimits', 'totalM', 'toast', 'persistPlanned', 'markDestination', 'lockOnDestination', 'booting', 'funOf',
  'FunRoute', 'avoid', 'let plannedRoute = null, explore = null; const timeMarksOf = () => []; const stepsOf = () => []; const paintSaveBtn = () => {}; const attachScenic = () => {}; const attachProfile = () => {}; const paintStops = () => {}; const paintEtaShareBtn = () => {}; const paintHomeBy = () => {}; return (' + source + ')')(
  () => loading.json('https://isolated.test', {}, 5),
  async () => { fallbackCalls++; return [{ coords: [[-84, 39], [-83.99, 39]], turns: [], timeS: 60 }]; },
  async (coords, id, name) => {
    await loading.yieldToUI(); analyzed = true;
    return { id, name, lat: [39, 39], lon: [-84, -83.99], dist: [0, 1000], events: [] };
  }, {}, drives,
  route => { assert.equal(analyzed, true); activated = route; },
  () => {}, { mode: 'sim' }, () => {}, () => {}, () => 1000, () => {}, () => {}, () => {}, () => {}, false, () => null,
  require(process.argv[1] + '/web/fun_route.js'), { tolls: true },
);
(async () => {
  await build([], 'isolated', 'Test route');
  assert.equal(fallbackCalls, 1);
  assert.equal(drives.length, 1);
  assert.equal(activated.id, 'isolated');
})().catch(error => { console.error(error); process.exitCode = 1; });
""")


def test_stage_scoring_yields_and_reports_real_progress():
    run_node(r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const loading = require(process.argv[1] + '/web/route_loading.js');
const source = fs.readFileSync(process.argv[1] + '/web/stages.js', 'utf8').match(/async function discover\(.*?\n  }/s)[0];
let scored = 0;
let yields = 0;
const progress = [];
const discover = new Function('roadPieces', 'strokes', 'bestWindow', 'applyHighlights', 'Loading', 'performance', 'return (' + source + ')')(
  async () => ['pieces'],
  () => ({ strokes: [1, 2, 3], ends: new Map() }),
  score => { scored++; return { score }; },
  stages => stages,
  { yieldToUI: async () => { yields++; await loading.yieldToUI(); } },
  { now: () => scored * 10 },
);
(async () => {
  const stages = await discover({}, 5, (phase, fraction) => progress.push([phase, fraction]));
  assert.equal(yields, 2);
  assert.deepEqual(stages.map(stage => stage.score), [3, 2, 1]);
  assert.deepEqual(progress[0], ['scoring', 0]);
  assert.deepEqual(progress.at(-1), ['scoring', 1]);
  assert.ok(progress.some(([phase, fraction]) => phase === 'scoring' && fraction > 0 && fraction < 1));
})().catch(error => { console.error(error); process.exitCode = 1; });
""")
