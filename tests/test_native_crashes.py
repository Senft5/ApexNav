"""Native crashes and hangs (ApexCrashReports.swift): MetricKit, started at launch, sent to our own /api/errors only."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = (ROOT / "ApexCrashReports.swift").read_text()


def test_started_at_launch_and_built():
    assert "ApexCrashReports.start()" in (ROOT / "ApexNavApp.swift").read_text()
    assert "- path: ApexCrashReports.swift" in (ROOT / "project.yml").read_text()


def test_goes_only_to_our_worker_anonymously():
    assert "MXMetricManager.shared.add(shared)" in SRC
    hosts = [l for l in SRC.splitlines() if "https://" in l]
    assert hosts and all("apexnav.senftns.workers.dev/api/errors" in l for l in hosts)
    assert "httpShouldHandleCookies = false" in SRC and "authorization" not in SRC.lower()
    assert '"kind": kind, "app": "ios"' in SRC


def test_the_worker_takes_the_two_kinds():
    errors = (ROOT / "backend/src/errors.ts").read_text()
    assert '"crash", "hang"' in errors
