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
  // U-109: the distance link names the corner it leads to, or goes
  named: P.plainChain([c({ severity: 5, link: '100' })], null, { next: c({ dir: 'R', severity: 5, mods: ['long'], caution: 1 }) }),
  toHazard: P.plainChain([c({ severity: 5, link: '100' })], null, { next: { type: 'bump', call: 'Bump' } }),
  card: P.plainChain([c({ mods: ['tightens'], caution: 1, link: '100' })], null, { next: c({ dir: 'R', severity: 2 }), card: true }),
  heads: [c({ mods: ['long'], caution: 3 }), c({ shape: 'square', dir: 'R' }), { type: 'crest', call: 'Crest' }, null].map(P.plainHead),
  // U-93: in the driver's units
  miles: (() => { globalThis.localStorage = { getItem: () => 'imperial', setItem() {} }; const U = require(process.argv[1] + '/web/units.js'); U._reset();
    const r = { links: ['120', '60', '350', '450', '500'].map((l) => P.plainLink(l, U)), chain: P.plainChain([c({ dir: 'L', severity: 4, link: '120' })], U),
      linked: P.plainChain([c({ dir: 'L', severity: 5, link: '120' })], U, { next: c({ dir: 'R', severity: 5 }) }),
      far: [300, 400, 800, 1609, 2500].map(U.spokenShort) };
    U.set('metric'); r.metric = ['120', '60'].map((l) => P.plainLink(l, U)).concat([U.spokenShort(1500)]); return r; })(),
}));
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_calls(out):
    # M-1 (panel round 1): the warning first, one short word per thing, every word of the scale its own sound
    assert out["calls"] == ["Medium left", "Tight right", "Slight left", "Hairpin left", "Square left",
                            "Hairpin right", "Slow down, medium left, tightens, slopes away",
                            "Medium left, over a crest, long, opens", "Bump"]
    for call in out["calls"]:
        assert not any(w in call.lower() for w in ("very", "sharp", "like a", "almost", "back on itself")), call


def test_links_and_chain(out):
    assert out["links"] == ["then", "then", "then 150 metres", "", ""]
    # U-109: with no next note the distance has nothing to lead to and goes; "then" is never left without a corner after it
    assert out["chain"] == "Medium left, then hairpin right"


def test_the_chain_names_the_corner_it_links_to(out):
    # its name and its warning, no modifiers: its own call comes in its turn (M-1: "then careful, square left in 200 feet")
    assert out["named"] == "Easy left, then careful, easy right in 100 metres"
    assert out["toHazard"] == "Easy left, then bump in 100 metres"
    assert out["heads"] == ["Medium left", "Square right", "Crest", ""]
    # Hale's delivery (U-113): each part its own sentence, the same words
    assert out["card"] == "Careful. Medium left. Tightens. Then tight right in 100 metres"


def test_links_follow_the_drivers_units(out):
    m = out["miles"]
    # feet in 50s under 1000 ft, then the quarter miles a driver hears (350 m is 1150 ft)
    assert m["links"] == ["then 400 feet", "then 200 feet", "then a quarter mile", "then a quarter mile", "then a quarter mile"]
    assert m["chain"] == "Open left"
    assert m["linked"] == "Easy left, then easy right in 400 feet"   # the owner's billet drive, 08:07:31
    assert m["far"] == ["a quarter mile", "a quarter mile", "half a mile", "a mile", "1.6 miles"]
    assert m["metric"] == ["then 120 metres", "then 60 metres", "1.5 kilometres"]


def test_page_offers_both_and_keeps_rally_for_existing_users():
    html = cockpit_source()
    assert 'data-words="plain"' in html and 'data-words="rally"' in html
    assert "saved.noteWords === 'plain' || saved.noteWords === 'rally' ? saved.noteWords : 'rally'" in html
    assert "if (state.noteWords === 'plain') return { text: ApexPlainNotes.plainChain(voiced, ApexUnits, { next, card }), chain: null, keys, voiced };" in html
    # U-109: the next note is the one after the chain, and never one past a junction not yet called
    assert "const next = after && !(noteM(after) > turnHold.m) ? after : null;" in html
