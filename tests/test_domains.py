"""The owner's domains (2026-11-14): shared links are built on vettadrive.app, which the iPhone app claims (Associated
Domains) for exactly the links the Worker's apple-app-site-association lists, and the app passes on only keys it knows."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
read = lambda p: (ROOT / p).read_text(encoding="utf-8")


def test_app_claims_vettadrive_app_and_the_aasa_keys_are_ones_the_app_passes_on():
    assert "com.apple.developer.associated-domains: [applinks:vettadrive.app]" in read("project.yml")
    swift = read("ApexNavApp.swift")
    keys = set(re.search(r'static let linkKeys: Set<String> = \[([^\]]+)\]', swift).group(1).replace('"', "").replace(" ", "").split(","))
    hosts = read("backend/src/hosts.ts")
    aasa = set(re.search(r'\.\.\.\[([^\]]+)\]\.map', hosts).group(1).replace('"', "").replace(" ", "").split(","))
    assert aasa <= keys, aasa - keys
    assert '"vettadrive.app"' in swift and 'frag.hasPrefix("road=")' in swift   # #road= arrives in the fragment


def test_share_links_use_vettadrive_app_and_legal_pages_vettadrive_com():
    sync = read("web/sync.js")
    assert "const SITE = 'https://vettadrive.app';" in sync and "siteBase: SITE_BASE" in sync
    cockpit = read("web/cockpit.js")
    assert "const shareOrigin = () => ApexSync.siteBase;" in cockpit and "siteOrigin: () => ApexSync.siteBase," in cockpit
    assert "const LEGAL_SITE = 'https://vettadrive.com';" in cockpit
    assert "ApexRoadLink.url(ApexSync.siteBase, token)" in read("web/analysis_page.js")
    assert "apexnav.senftns.workers.dev/privacy" not in read("web/index.html")


def test_the_app_calls_the_worker_on_vettadrive_app():
    """The app's own calls (page /api, the shell's bridge, sign-in, crash reports, build notices) go to vettadrive.app; old
    builds keep calling workers.dev, which the Worker still answers (wrangler.jsonc workers_dev)."""
    assert "const API_BASE = IN_APP ? SITE : '';" in read("web/sync.js")
    for f in ["ApexNavApp.swift", "ApexBuildNotifier.swift", "ApexCrashReports.swift", "web/errors.js", "web/cameras.js", "web/graph_tiles.js"]:
        src = read(f)
        assert "senftns.workers.dev" not in src and "https://vettadrive.app" in src, f
    csp = read("tools/csp.py")
    assert '"https://vettadrive.app"' in csp and '"wss://vettadrive.app"' in csp
    assert '"workers_dev": true' in read("wrangler.jsonc")
