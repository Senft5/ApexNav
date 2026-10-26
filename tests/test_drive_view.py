"""Drive view (web/drive_view.js): summary numbers are computed from the data, never invented."""
import json
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = r"""
const Core = require(process.argv[1] + '/web/apex_core.js');
const V = require(process.argv[1] + '/web/drive_view.js');
const n = 400, speed = Array.from({ length: n }, (_, i) => 10 + (i % 50) / 5);
const d = { lat: speed.map((_, i) => 35 + i * 5 / 110540), lon: speed.map(() => -83), dist: speed.map((_, i) => i * 5), speed_mps: speed,
  lat_g: speed.map((_, i) => 0.3 * Math.sin(i / 10)), lon_g: speed.map((_, i) => (i === 100 ? -0.5 : 0.05)), elev: speed.map((_, i) => 100 + i * 0.5 - (i > 200 ? (i - 200) * 1.5 : 0)), corners: [] };
const full = V.summarize(d, Core);
const bare = V.summarize({ ...d, lat_g: null, lon_g: null, elev: null }, Core);

// Minimal DOM shim to verify mount() summary hierarchy and scrub readout visibility
function mkEl(tag) {
  const listeners = {};
  const node = {
    tag, className: '', innerHTML: '', hidden: false, dataset: {}, style: {}, children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    append(...kids) { this.children.push(...kids); },
    setAttribute(k, v) { this[k] = v; },
    addEventListener(k, fn) { (listeners[k] = listeners[k] || []).push(fn); },
    dispatch(k, ev) { (listeners[k] || []).forEach(fn => fn(ev)); },
    getBoundingClientRect() { return { left: 0, width: 600 }; },
    querySelector(sel) {
      if (sel === '#dvDot' || sel === '#dvWin' || sel === '#dvHair') return { setAttribute() {}, style: {} };
      return this.children.find(c => sel === '.' + c.className) || null;
    },
    querySelectorAll(sel) {
      if (sel === 'button') return this.children.filter(c => c.tag === 'button');
      return [];
    },
    get lastChild() { return this.children[this.children.length - 1]; },
    get firstChild() { return this.children[0]; }
  };
  return node;
}
global.document = { createElement: mkEl };
global.ResizeObserver = class { observe() {} disconnect() {} };

const C = { panel: '#EDE4D3', panelInk: '#1C1A17', panelDim: '#6F675A', rule: '#1C1A17', accent: '#C8102E', signal: '#C8102E' };
const rootScored = mkEl('div');
const scoredDrive = { ...d, corners: [{ start: 10, apex: 20, end: 30, apex_mps: 12, code: 'L3', call: 'LEFT 3' }],
  ds: { score: 673, corners: 1, components: { pace: 0.85, smoothness: 0.72, braking: 0.91, consistency: 0.78 } } };
V.mount(rootScored, scoredDrive, { Core, C, MPH: Core.MPS_TO_MPH });
const headHtml = rootScored.children[0].innerHTML;
const rightCol = rootScored.children[1].children[1];
const zoomEl = rightCol.children[0], lanesEl = rightCol.children[1], readEl = rightCol.children[2];
const hiddenBeforeScrub = readEl.hidden;
lanesEl.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
const hiddenAfterKeyScrub = readEl.hidden;

const rootUnscored = mkEl('div');
V.mount(rootUnscored, { ...d, ds: { score: null, corners: 0, components: null } }, { Core, C, MPH: Core.MPS_TO_MPH });
const unscoredHeadHtml = rootUnscored.children[0].innerHTML;
const rightCol2 = rootUnscored.children[1].children[1];
const zoomEl2 = rightCol2.children[0], readEl2 = rightCol2.children[2];
const hiddenBeforeZoom = readEl2.hidden;
zoomEl2.children[1].onclick();
const hiddenAfterZoom = readEl2.hidden;

console.log(JSON.stringify({ full, bare, headHtml, unscoredHeadHtml, hiddenBeforeScrub, hiddenAfterKeyScrub, hiddenBeforeZoom, hiddenAfterZoom }));
"""


@pytest.fixture(scope="module")
def r():
    root = str(__import__("pathlib").Path(__file__).resolve().parents[1])
    p = subprocess.run([NODE, "-e", RUNNER, root], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_summary_numbers(r):
    f = r["full"]
    assert f["km"] == pytest.approx(1.995, abs=0.01)
    assert f["top_mps"] == pytest.approx(19.8, abs=0.01)
    assert f["peak_lat_g"] == pytest.approx(0.3, abs=0.01)
    assert f["peak_brake_g"] == pytest.approx(0.5)
    assert f["climb_m"] == pytest.approx(100.0, abs=1.0)        # only climbing counts: the descent is excluded


def test_missing_channels_stay_unknown(r):
    b = r["bare"]
    assert b["peak_lat_g"] is None and b["peak_brake_g"] is None and b["climb_m"] is None


def test_summary_hierarchy_and_scrub_readout(r):
    h = r["headHtml"]
    assert "673" in h and "/1000" in h
    for part in ("Pace 85", "Smooth 72", "Brakes 91", "Rhythm 78"):
        assert part in h
    assert "1.2 mi · 2:19 · 1 corners" in h
    for removed in ("Top speed", "Peak lateral", "Peak braking", "Climb"):
        assert removed not in h
    u = r["unscoredHeadHtml"]
    assert "><b class=\"score big\">--</b> <small>/1000</small>" in u
    assert "Pace --" in u and "Smooth --" in u and "Brakes --" in u and "Rhythm --" in u
    assert r["hiddenBeforeScrub"] is True and r["hiddenAfterKeyScrub"] is False
    assert r["hiddenBeforeZoom"] is True and r["hiddenAfterZoom"] is False
