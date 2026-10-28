"""Content-Security-Policy for every web page (IDEAS Z-11): one policy, the page's own inline scripts allowed by hash.

Written into each page as a <meta http-equiv> tag so it holds in the iOS shell (pages served from the app bundle) as well
as on the web. Run after editing an inline <script> in web/*.html:

    python tools/csp.py

tests/test_csp.py fails while a page's tag is out of date. Every host the app talks to is listed here; a new one is a
deliberate change (and e2e/smoke.js fails on any CSP violation).
"""
import base64
import hashlib
import pathlib
import re
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"
CONNECT = [
    "https://apexnav.senftns.workers.dev",            # the Worker, from the iOS shell (on the web it's 'self')
    "https://tiles.openfreemap.org",                  # map style, tiles, glyphs, sprites
    "https://s3.amazonaws.com",                       # Terrarium DEM
    "https://valhalla1.openstreetmap.de",             # routing, matrix, map matching
    "https://router.project-osrm.org",                # fallback router
    "https://overpass-api.de", "https://overpass.private.coffee", "https://overpass.kumi.systems",   # OSM lookups
    "https://nominatim.openstreetmap.org", "https://photon.komoot.io",                               # search
    "https://api.open-meteo.com",                     # forecast along the route
    "https://vpic.nhtsa.dot.gov",                     # VIN lookup
    "https://cdn.jsdelivr.net",                       # the voice engine and its runtime
    "https://huggingface.co", "https://*.huggingface.co", "https://*.hf.co",                         # the voice model
]
MARK = '<meta http-equiv="Content-Security-Policy"'


def inline_scripts(html):
    """The text of each inline <script> (no src), exactly as the browser hashes it."""
    return [m.group(1) for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S)]


def policy(html):
    hashes = " ".join("'sha256-%s'" % base64.b64encode(hashlib.sha256(s.encode("utf-8")).digest()).decode() for s in inline_scripts(html))
    return "; ".join([
        "default-src 'self'",
        "script-src 'self' %s https://cdn.jsdelivr.net 'wasm-unsafe-eval'" % hashes if hashes else "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
        "worker-src 'self' blob:",
        "child-src 'self' blob:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://tiles.openfreemap.org https://s3.amazonaws.com",
        "media-src 'self' data: blob:",
        "connect-src 'self' data: blob: " + " ".join(CONNECT),
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
    ])


def tag(html):
    return '%s content="%s" />' % (MARK, policy(html))


def with_tag(html):
    """The page with its policy tag up to date (added right after <meta charset>, or replaced)."""
    stripped = re.sub(r"\n[ \t]*" + re.escape(MARK) + r'[^>]*/>', "", html)
    m = re.search(r'([ \t]*)<meta charset="UTF-8" />', stripped)
    if not m:
        raise SystemExit("no <meta charset> in page")
    return stripped[:m.end()] + "\n" + m.group(1) + tag(stripped) + stripped[m.end():]


def pages():
    return sorted(WEB.glob("*.html"))


if __name__ == "__main__":
    changed = 0
    for p in pages():
        old = p.read_text(encoding="utf-8")
        new = with_tag(old)
        if new != old:
            p.write_text(new, encoding="utf-8")
            changed += 1
            print("updated", p.name)
    print(f"{changed} page(s) updated" if changed else "all pages up to date", file=sys.stderr)
