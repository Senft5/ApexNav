"""Pace notes in plain words (web/plain_notes.js, IDEAS V-02)."""
import json
import os
import shutil
import subprocess

import pytest
from tests.page_source import cockpit_source

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const P = require(process.argv[1] + '/web/plain_notes.js');
const c = (o) => ({ type: 'corner', dir: 'L', severity: 3, mods: [], caution: 0, ...o });
console.log(JSON.stringify({
  calls: [c({}), c({ dir: 'R', severity: 1 }), c({ severity: 6 }), c({ severity: 'HP', shape: 'hairpin' }), c({ shape: 'square' }), c({ shape: 'acute', dir: 'R' }),
          c({ mods: ['tightens', 'off-camber'], caution: 2 }), c({ mods: ['over crest', 'long', 'opens'] }), { type: 'bump', call: 'Bump' }].map(P.plainCall),
  links: ['into', 'and', '150', null, 'odd'].map(P.plainLink),
  chain: P.plainChain([c({ link: 'into' }), c({ dir: 'R', severity: 'HP', shape: 'hairpin', link: '100' })]),
  // U-93: in the driver's units
  miles: (() => { globalThis.localStorage = { getItem: () => 'imperial', setItem() {} }; const U = require(process.argv[1] + '/web/units.js'); U._reset();
    const r = { links: ['120', '60', '350', '450', '500'].map((l) => P.plainLink(l, U)), chain: P.plainChain([c({ dir: 'L', severity: 4, link: '120' })], U),
      far: [300, 400, 800, 1609, 2500].map(U.spokenShort) };
    U.set('metric'); r.metric = ['120', '60'].map((l) => P.plainLink(l, U)).concat([U.spokenShort(1500)]); return r; })(),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_calls(out):
    assert out["calls"] == ["Medium left", "Very tight right", "Slight left", "Hairpin left", "Sharp left, like a junction",
                            "Very sharp right, almost back on itself", "Medium left, tightens, slopes away, slow down",
                            "Medium left, over a crest, long, opens up", "Bump"]


def test_links_and_chain(out):
    assert out["links"] == ["then", "then", "then 150 metres", "", ""]
    assert out["chain"] == "Medium left then Hairpin right, then 100 metres"


def test_links_follow_the_drivers_units(out):
    m = out["miles"]
    # feet in 50s under 1000 ft, then the quarter miles a driver hears (350 m is 1150 ft)
    assert m["links"] == ["then 400 feet", "then 200 feet", "then a quarter mile", "then a quarter mile", "then a quarter mile"]
    assert m["chain"] == "Open left, then 400 feet"
    assert m["far"] == ["a quarter mile", "a quarter mile", "half a mile", "a mile", "1.6 miles"]
    assert m["metric"] == ["then 120 metres", "then 60 metres", "1.5 kilometres"]


def test_page_offers_both_and_keeps_rally_for_existing_users():
    html = cockpit_source()
    assert 'data-words="plain"' in html and 'data-words="rally"' in html
    assert "saved.noteWords === 'plain' || saved.noteWords === 'rally' ? saved.noteWords : 'rally'" in html
    assert "if (state.noteWords === 'plain') return { text: ApexPlainNotes.plainChain(voiced, ApexUnits), chain: null, keys };" in html
