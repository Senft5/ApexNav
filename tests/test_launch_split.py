"""A launch that carries the launch (REVIEW_FEEL F-03, F-12): the cockpit's script is a file, every launch script is
deferred, People / Garage / crews / convoy / friends / the phonemizer are lazy, and no page asks Google for a font."""
import json
import pathlib
import re
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
NODE = shutil.which("node")


def groups():
    out = subprocess.run([NODE, "-e", "process.stdout.write(JSON.stringify(require(process.argv[1]).GROUPS))", str(WEB / "lazy.js")],
                         capture_output=True, text=True, timeout=30, check=True).stdout
    return json.loads(out)


def tags(html):
    return re.findall(r'<script src="([^"]+)"( defer)?></script>', html)


def test_launch_scripts_are_deferred_in_order_and_the_cockpit_is_last():
    html = (WEB / "index.html").read_text()
    t = tags(html)
    sync = [s for s, d in t if not d]
    assert sync == ["errors.js", "themes.js"], sync          # errors first (sees everything), the last look before first paint
    assert t[-2:] == [("lazy.js", " defer"), ("cockpit.js", " defer")]
    for s, _ in t:
        assert (WEB / s).exists(), s


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_lazy_modules_are_not_on_the_launch_path_and_exist():
    html = (WEB / "index.html").read_text()
    launch = {s for s, _ in tags(html)}
    g = groups()
    assert {"crew_page.js", "garage_ui.js", "builds.js", "convoy_ui.js", "friends_map.js"} <= set(g["social"])
    assert g["g2p"] == ["g2p.js"]
    for name, files in g.items():
        for f in files:
            assert (WEB / f).exists(), f
            assert f not in launch, f"{f} is lazy ({name}) but index.html still loads it at launch"


def test_social_mounts_wait_for_their_modules():
    js = (WEB / "cockpit.js").read_text()
    # every mount of a social module is queued, never run at launch
    for mod in ("ApexConvoyUI", "ApexSafetyUI", "ApexCrewEvents", "ApexCrewPage", "ApexFeedback", "ApexCrewStandings", "ApexSpotsFeed",
                "ApexBuilds", "ApexFriendsMap", "ApexWhoSees", "ApexGarageUI"):
        i = js.index(f"{mod}.mount(")
        here = js[js.rfind("\n", 0, js.rfind("\n", 0, i)) + 1:i]                    # its line and the one before
        assert "onSocial(() => {" in here, mod
    assert "ApexLazy.load('social')" in js
    assert "if ((v === 'people' || v === 'garage') && !socialIn) needSocial();" in js           # first use
    assert "map.once('idle', () => setTimeout(go, 300))" in js                                   # or once the launch is over
    voice = (WEB / "voice.js").read_text()
    assert "if (!root.ApexG2P && root.ApexLazy) await root.ApexLazy.load('g2p');" in voice


def test_no_page_asks_google_for_fonts_and_the_fonts_ship_with_their_licence():
    for p in list(WEB.glob("*.html")) + list(WEB.glob("*.css")) + list(WEB.glob("*.js")):
        assert not re.search(r"fonts\.(googleapis|gstatic)\.com", p.read_text(encoding="utf-8")), p.name
    css = (WEB / "fonts" / "fonts.css").read_text()
    for f in re.findall(r"url\(([^)]+)\)", css):
        assert (WEB / "fonts" / f).read_bytes()[:4] == b"wOF2", f
    assert "font-display: optional" in css and "'Barlow Condensed'" in css and "'Inter Tight'" in css
    ofl = (WEB / "fonts" / "OFL.txt").read_text()
    assert "SIL OPEN FONT LICENSE Version 1.1" in ofl and "The Barlow Project Authors" in ofl and "The Inter Project Authors" in ofl
    assert "fonts/OFL.txt" in (WEB / "licenses.html").read_text()
    assert "web/fonts/OFL.txt" in (ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    for page in ("index.html", "analysis.html"):
        html = (WEB / page).read_text()
        assert '<link rel="stylesheet" href="fonts/fonts.css" />' in html
        assert '<link rel="preload" href="fonts/inter-tight.woff2" as="font" type="font/woff2" crossorigin />' in html
