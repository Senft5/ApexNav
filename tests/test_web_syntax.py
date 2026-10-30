"""Every script the browser runs must at least parse. A single stray character in the inline script of index.html or analysis.html
takes the whole page down, and nothing else in the suite loads those pages."""
import pathlib
import re
import shutil
import subprocess
import tempfile

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
WEB = pathlib.Path(__file__).resolve().parents[1] / "web"


def _check(src: str, name: str) -> None:
    with tempfile.TemporaryDirectory() as d:
        f = pathlib.Path(d) / name
        f.write_text(src)
        r = subprocess.run([NODE, "--check", str(f)], capture_output=True, text=True, timeout=60)
        assert r.returncode == 0, f"{name}: {r.stderr.splitlines()[:5]}"


def test_the_cockpit_has_no_inline_script():
    """REVIEW_FEEL F-03: index.html's script is web/cockpit.js (checked with the other files below), so WebKit caches it."""
    html = (WEB / "index.html").read_text()
    assert not re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html)
    assert re.search(r'<script src="cockpit.js"( defer)?></script>', html)


@pytest.mark.parametrize("page", ["analysis.html"])
def test_inline_scripts_parse(page):
    html = (WEB / page).read_text()
    scripts = re.findall(r"<script>\n(.*?)</script>", html, re.S)
    assert scripts, f"no inline script found in {page}"
    for i, s in enumerate(scripts):
        _check(s, f"{page}.{i}.js")


@pytest.mark.parametrize("js", sorted(p.name for p in WEB.glob("*.js")))
def test_script_files_parse(js):
    _check((WEB / js).read_text(), js)
