"""Content-Security-Policy on every page (tools/csp.py, IDEAS Z-11): present, current with the page's inline scripts, and
strict where it matters (no eval, no plugins, no other site's scripts but the voice engine's CDN, no unknown hosts)."""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("csp", ROOT / "tools" / "csp.py")
csp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(csp)


def test_every_page_has_a_current_policy():
    for p in csp.pages():
        html = p.read_text(encoding="utf-8")
        assert html.count(csp.MARK) == 1, p.name
        assert csp.with_tag(html) == html, f"{p.name}: inline script changed; run python tools/csp.py"


def test_the_policy_is_strict():
    pol = csp.policy("<script>x()</script>")
    d = dict(part.split(" ", 1) for part in pol.split("; "))
    assert "'unsafe-inline'" not in d["script-src"] and "'unsafe-eval'" not in d["script-src"]
    assert d["script-src"].count("'sha256-") == 1
    assert d["object-src"] == "'none'" and d["base-uri"] == "'none'"
    assert "https:" not in d["connect-src"].split() and "*" not in d["connect-src"].split()
    assert d["default-src"] == "'self'"


def test_tag_goes_after_the_charset_and_is_idempotent():
    page = '<head>\n  <meta charset="UTF-8" />\n  <title>t</title>\n</head><script>a()</script>'
    once = csp.with_tag(page)
    assert once.splitlines()[2].lstrip().startswith(csp.MARK)
    assert csp.with_tag(once) == once
