"""Pace notes in plain words (web/plain_notes.js, IDEAS V-02)."""
import json
import os
import shutil
import subprocess

import pytest

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


def test_page_offers_both_and_keeps_rally_for_existing_users():
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    assert 'data-words="plain"' in html and 'data-words="rally"' in html
    assert "saved.noteWords === 'plain' || saved.noteWords === 'rally' ? saved.noteWords : 'rally'" in html
    assert "if (state.noteWords === 'plain') return { text: ApexPlainNotes.plainChain(voiced), chain: null };" in html
