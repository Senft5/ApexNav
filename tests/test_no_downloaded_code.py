"""App Review guideline 2.5.2 (docs/APP_REVIEW.md): the app runs only code it ships. No page loads a remote script, and the
one remote module (the website's live voice engine, transformers.js) is never loaded inside the iOS app."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()


def test_no_page_loads_a_remote_script():
    for name in os.listdir(WEB):
        if name.endswith(".html"):
            html = read("web", name)
            assert not re.search(r"<script[^>]+src=[\"']https?:", html), name


def test_remote_imports_only_the_guarded_voice_engine():
    hits = []
    for name in os.listdir(WEB):
        if name.endswith(".js"):
            for m in re.finditer(r"import\(\s*['\"`]?([A-Za-z_]+|https?:[^'\"`)]+)", read("web", name)):
                hits.append((name, m.group(1)))
    assert hits == [("voice.js", "TRANSFORMERS_JS")], hits
    voice = read("web", "voice.js")
    i = voice.index("function warmLive()")
    assert "if (IN_APP) return Promise.resolve(null);" in voice[i:i + 120]       # the first thing warmLive does in the app


def test_app_hides_the_switch():
    html = read("web", "index.html")
    assert "if (IN_APP_SHELL) { state.liveVoice = false; $('liveVoiceBtn').hidden = true;" in html


def test_licences_page_ships_every_vendored_notice():
    page = read("web", "licenses.html")
    assert "licenses.html" in read("web", "index.html")                       # linked from Settings
    for needle in ("MapLibre GL JS", "maplibre-contour", "Kazuhiko Arase", "Kokoro-82M", "OpenStreetMap contributors",
                   "BSD 3-Clause License", "MIT License", "g2p/LICENSE-APACHE-2.0.txt"):
        assert needle in page, needle
    assert os.path.exists(os.path.join(WEB, "g2p", "LICENSE-APACHE-2.0.txt"))
    vendored = {"maplibre-gl.js": "MapLibre GL JS", "maplibre-contour.min.js": "maplibre-contour", "qrcode.js": "QR Code Generator"}
    for f in os.listdir(os.path.join(WEB, "vendor")):
        if f.endswith(".js"):
            assert f in vendored and vendored[f] in page, f                     # a new vendored file needs its notice here


def test_landing_page_links_and_shots_exist():
    page = read("web", "about.html")
    for href in re.findall(r'(?:href|src)="([^"#?:]+)', page):
        assert os.path.exists(os.path.join(WEB, href)), href                     # every local link and image is there
    for claim in ("Never how fast", "Free to drive", "not a racing app"):
        assert claim in page
