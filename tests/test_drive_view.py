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
    prepend(...kids) { this.children.unshift(...kids); },
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

// Corner coach: the ideal drive line, a "Where to find time" list and a tip on the corner card; names are escaped.
const coachCorner = { apex: 20, m: { time_s: 4 }, best: { time_s: 3.5 }, best_from: 0, gain_s: 0.5, tip: { kind: 'brake_later', value: 22 }, passes: 2 };
const rootCoach = mkEl('div');
V.mount(rootCoach, scoredDrive, { Core, C, MPH: Core.MPS_TO_MPH,
  coach: { corners: [coachCorner], clean: 1, this_s: 4, ideal_s: 3.5, gain_s: 0.5, top: [0], others: [{ name: 'x', date: '<i>Oct 2</i>' }] } });
const coachHead = rootCoach.children[0].innerHTML, coachList = rootCoach.children[2];
const timeList = coachList.children.find((c) => c.className === 'dv-time'), timeHtml = timeList.children[0].children[0].innerHTML;
const cardHtml = coachList.children.find((c) => c.className === 'dv-corners').children[0].innerHTML;
const rootAlone = mkEl('div');
V.mount(rootAlone, scoredDrive, { Core, C, MPH: Core.MPS_TO_MPH,
  coach: { corners: [{ ...coachCorner, best: null, best_from: -1, gain_s: 0, passes: 1, tip: { kind: 'coast', value: 30 } }], clean: 1, this_s: 4, ideal_s: 4, gain_s: 0, top: [], others: [] } });
const coastNear = V.tipText({ best: { time_s: 3.9 }, tip: { kind: 'coast', value: 85, vs_best: false } }, Core.MPS_TO_MPH);
const aloneHead = rootAlone.children[0].innerHTML, aloneList = rootAlone.children[2].children.map((c) => c.className);
const aloneCard = rootAlone.children[2].children.find((c) => c.className === 'dv-corners').children[0].innerHTML;

// Road feel readout names how far to trust each value.
global.ApexContributor = require(process.argv[1] + '/web/contributor.js');
const rootFeel = mkEl('div');
const vFeel = V.mount(rootFeel, scoredDrive, { Core, C, MPH: Core.MPS_TO_MPH });
const nn = d.lat.length, fill = (v) => Array.from({ length: nn }, () => v);
vFeel.setRoadFeel({ cam: fill(4.2), rough: fill(0.12), n: fill(3), cn: fill(3), csd: fill(0.5), rsd: fill(0.2) });
vFeel.move(5);
const feelRead = rootFeel.children[1].children[1].children[2].innerHTML;

// Grip circle: shown with measured g, absent without it; scrubbing into a corner names its grip use.
const ggCol = rootScored.children[1].children[1].children[3];
const ggCaption = ggCol ? ggCol.children[2].textContent : null;
lanesEl.dispatch('keydown', { key: 'Home' }); for (let q = 0; q < 4; q++) lanesEl.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
const ggCorner = ggCol ? ggCol.children[2].textContent : null;
const rootNoG = mkEl('div');
V.mount(rootNoG, { ...scoredDrive, g_known: d.lat.map(() => 0) }, { Core, C, MPH: Core.MPS_TO_MPH });
const ggNone = rootNoG.children[1].children[1].children.length;

console.log(JSON.stringify({ full, bare, headHtml, unscoredHeadHtml, hiddenBeforeScrub, hiddenAfterKeyScrub, hiddenBeforeZoom, hiddenAfterZoom,
  coachHead, timeHtml, cardHtml, aloneHead, aloneList, aloneCard, coastNear, ggCaption, ggCorner, ggNone, feelRead }));
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


def test_corner_coach_shows_ideal_time_and_tips(r):
    assert "Ideal drive" in r["coachHead"] and "0.50 s" in r["coachHead"] and "from 1 drive<" in r["coachHead"]
    t = r["timeHtml"]
    assert "Brake 22 m later, like your best pass" in t and "+0.50 s" in t
    assert "&#60;i&#62;Oct 2&#60;/i&#62;" in t and "<i>" not in t, "drive names and dates are escaped"
    assert "Brake 22 m later" in r["cardHtml"]


def test_corner_coach_alone_has_no_ideal_but_keeps_the_habit_tip(r):
    assert "Ideal drive" not in r["aloneHead"], "one pass of each corner is no ideal"
    assert "dv-time" not in r["aloneList"]
    assert "30 m coasting between brake and throttle" in r["aloneCard"]


def test_coast_tip_wording_follows_the_tip_not_the_best_pass(r):
    assert r["coastNear"] == "85 m coasting between brake and throttle"


def test_grip_circle_from_measured_g_only(r):
    assert r["ggCaption"].startswith("Your grip on this drive: braking")
    assert r["ggCorner"].startswith("Corner 1, from 100 m before turn-in to the exit:") and "%" in r["ggCorner"]
    assert r["ggNone"] == 3, "no measured g: no grip circle"


def test_road_feel_says_how_far_to_trust_it():
    root = str(__import__("pathlib").Path(__file__).resolve().parents[1])
    js = r"""
global.window = global; const C2 = require(process.argv[1] + '/web/contributor.js'); global.ApexContributor = C2;
const tests = [C2.agreement(1, null, 1.5), C2.agreement(3, 0.4, 1.5), C2.agreement(3, 2.2, 1.5), C2.agreement(0, null, 1.5), C2.agreement(2, null, 1.5)];
const roads = { 7: { 0: { i: [0, 1, 2], n: [1, 3, 4], cam: [2, 4, -3], cn: [1, 3, 2], csd: [null, 0.4, 2.2], rough: [0.1, 0.2, 0.3], rsd: [null, 0.01, 0.2] } } };
const old = { 7: { 0: { i: [0], n: [3], cam: [2], rough: [0.1] } } };
const runs = [{ way: 7, dir: 0, pts: [{ i: 0, bin: 0 }, { i: 1, bin: 1 }, { i: 2, bin: 2 }, { i: 3, bin: 9 }] }];
console.log(JSON.stringify({ tests, s: C2.seriesFrom(runs, roads, 4), o: C2.seriesFrom(runs, old, 4) }));
"""
    p = subprocess.run([NODE, "-e", js, root], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout)
    assert r["tests"] == ["one", "agree", "differ", None, None], "two passes without a spread are not called agreeing"
    s = r["s"]
    assert s["cn"] == [1, 3, 2, None] and s["csd"] == [None, 0.4, 2.2, None] and s["rsd"] == [None, 0.01, 0.2, None]
    o = r["o"]
    assert o["cam"][0] == 2 and o["csd"][0] is None and o["cn"][0] is None, "an older server's payload still reads, spread unknown"


def test_road_feel_readout_labels_agreement(r):
    assert "Banking · 3 runs agree" in r["feelRead"] and "4.2°" in r["feelRead"]
    assert "Roughness · runs differ ±0.20 g" in r["feelRead"]
