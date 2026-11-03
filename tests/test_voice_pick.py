"""The co-driver's voice is its own choice (the owner, 2026-11-03: car themes "should have access to any voice pack").
A theme suggests a pack; the driver can pick any pack with any theme, private ones included, in one place (the Garage's
Look and voice, data-pack: web/vocabulary.js TERMS.pack, held to one home by tests/test_vocabulary.py), and the pick stays
across theme changes and restarts. Suggested goes back to the theme's."""
import json
import os
import re
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_the_pick_is_a_setting_with_every_pack():
    terms = json.loads(subprocess.run([NODE, "-e", "console.log(JSON.stringify(require(process.argv[1]).TERMS))", os.path.join(ROOT, "web", "vocabulary.js")],
                                      capture_output=True, text=True, check=True).stdout)
    packs = [v["name"] for v in json.loads(read("web", "voices", "index.json"))["voices"]]
    t = terms["pack"]
    assert t["kind"] == "setting" and t["control"] == "data-pack" and t["homes"] == 1
    assert t["values"][0] == "Suggested" and sorted(t["values"][1:]) == sorted(packs), "every pack on the phone, with any theme"
    html = read("web", "index.html")
    ids = re.findall(r'data-pack="([a-z]+)"', html)
    assert ids == ["look"] + [v.lower() for v in t["values"][1:]]
    i = html.index('id="lookSection"')
    assert 'id="packSwitch"' in html[i:html.index("</section>", i)], "its one home is Look and voice"


def test_the_pick_wins_over_the_theme_and_is_kept():
    js = read("web", "cockpit.js")
    tv = js[js.index("    function themeVoice() {"):js.index("    function renderVoiceList()")]
    assert "const want = state.voicePick || (look && look.theme && look.theme.voice ? look.theme.voice.id : null);" in tv
    assert "voicePick: state.voicePick," in js, "kept in the prefs"
    assert "if (typeof saved.voicePick === 'string' && /^[a-z]{1,20}$/.test(saved.voicePick)) state.voicePick = saved.voicePick;" in js
    assert "state.voicePick = b.dataset.pack === 'look' ? null : b.dataset.pack;" in js
    # a theme change never touches the pick: only the pack switch (and the saved prefs) write it
    assert len(re.findall(r"state\.voicePick = ", js)) == 2
    assert "Suggested voice: ${t.voice ? t.voice.name : '--'}" in js, "the card says the theme suggests, not decides"
