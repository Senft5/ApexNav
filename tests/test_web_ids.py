"""Every id the page scripts look up must exist in the markup (a removed button once left a null dereference that broke the whole page)."""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


def _check(name):
    src = (WEB / name).read_text()
    ids = set(re.findall(r'id="([^"]+)"', src))
    used = set(re.findall(r"\$\('([A-Za-z0-9_-]+)'\)", src)) | set(re.findall(r"getElementById\('([^']+)'\)", src))
    # ids created at runtime by the script itself are written as `id: 'x'` or `.id = 'x'`
    made = set(re.findall(r"\bid: '([^']+)'", src)) | set(re.findall(r"\.id = '([^']+)'", src))
    assert not (used - ids - made), f"{name}: no element with id {sorted(used - ids - made)}"


def test_index_ids():
    _check("index.html")


def test_analysis_ids():
    _check("analysis.html")
