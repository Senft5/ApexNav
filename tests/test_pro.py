"""ApexNav Pro rules (web/pro.js, docs/MONETIZATION.md): everything is open while the `pro` flag is off; with it on, a free
account keeps every safety, road-data and own-data feature and gets one offline area and one car; Pro or a live trial opens
everything; an expired trial closes again; the app never mentions Pro while driving and at most once a week."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/pro.js');
const now = Date.parse('2026-11-10T12:00:00Z'), DAY = 86400000;
const off = P.state(false, null, null, now), free = P.state(true, { active: false, trial_used: false }, null, now);
const bought = P.state(true, null, { active: true, source: 'purchase', until: null }, now);
const trial = P.state(true, { active: true, source: 'trial', until: new Date(now + 3 * DAY).toISOString() }, null, now);
const expired = P.state(true, { active: true, source: 'trial', until: new Date(now - DAY).toISOString(), trial_used: true }, null, now);
const feats = Object.keys(P.FEATURES);
const all = (s) => feats.every((f) => P.has(s, f));
console.log(JSON.stringify({
  feats, never: P.NEVER_GATED,
  off: all(off), offLimit: P.limit(off, 'offline_areas'),
  freeHas: feats.filter((f) => P.has(free, f)), freeLimits: [P.limit(free, 'offline_areas'), P.limit(free, 'garage_cars')],
  freeNever: P.NEVER_GATED.every((f) => P.has(free, f)), freeTypo: P.has(free, 'trak_mode'),
  bought: all(bought), boughtLimit: P.limit(bought, 'garage_cars'),
  trial: all(trial), trialSource: trial.source, expired: all(expired), expiredUsed: expired.trialUsed,
  ask: [P.canAsk({ driving: true, nowMs: now }), P.canAsk({ speedMps: 9, nowMs: now }), P.canAsk({ speedMps: 0, nowMs: now }),
        P.canAsk({ speedMps: 0, lastAskedMs: now - 2 * DAY, nowMs: now }), P.canAsk({ lastAskedMs: now - 8 * DAY, nowMs: now }), P.canAsk(null)],
}));
"""


@pytest.fixture(scope="module")
def r():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_flag_off_opens_everything(r):
    assert r["off"] is True and r["offLimit"] is None  # Infinity serialises as null


def test_free_account(r):
    assert r["freeHas"] == ["offline_areas", "garage_cars"]  # counted things are allowed, up to their limit
    assert r["freeLimits"] == [1, 1]
    assert r["freeNever"] is True
    assert r["freeTypo"] is True


def test_pro_and_trial(r):
    assert r["bought"] is True and r["boughtLimit"] is None
    assert r["trial"] is True and r["trialSource"] == "trial"
    assert r["expired"] is False and r["expiredUsed"] is True


def test_never_asks_while_driving_and_at_most_weekly(r):
    assert r["ask"] == [False, False, True, False, True, False]


def test_safety_road_data_and_own_data_are_never_pro(r):
    # MONETIZATION.md §1 rules 2-4: if one of these ever lands in FEATURES, this fails
    sacred = {"pace_notes", "directions", "hazards", "closures", "crash_check", "convoy", "convoy_hazards", "typing_lock",
              "road_data", "measured_roads", "gpx_export", "my_data", "erase", "carplay"}
    assert sacred <= set(r["never"])
    assert not (set(r["feats"]) & set(r["never"]))
    for f in r["feats"]:
        assert not any(w in f for w in ("hazard", "safety", "crash", "convoy", "export", "erase", "note", "data", "direction"))
