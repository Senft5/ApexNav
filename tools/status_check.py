#!/usr/bin/env python3
"""Synthetic status checks (docs/IDEAS.md Y-05), run every 30 minutes by .github/workflows/status.yml.

Core checks are ApexNav's own: the site and the API with its database. When one fails the workflow opens (or comments on)
an "outage" issue and closes it once everything is back. Dependency checks are the free public services the app leans on
(routing, map tiles, elevation, Overpass); they never open an issue, because nothing can be done about them from here, but
their record in the run summary is the evidence for IDEAS Y-04 (our own router).

    python tools/status_check.py [--base https://apexnav.senftns.workers.dev]

Prints a Markdown table (also appended to $GITHUB_STEP_SUMMARY), writes status.json ({core_ok, failing}) for the
workflow, and exits 1 when a core check fails. A crash writes no status.json, so the workflow can't mistake it for an outage.
Standard library only; every request has a 10 s timeout and one retry so a single slow answer isn't an outage.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://apexnav.senftns.workers.dev"
UA = "ApexNav-status/1 (+https://github.com/Senft5/ApexNav)"
# Two points on a Knoxville road: a route of a few hundred metres, cheap for the public routers.
A, B = (35.9606, -83.9207), (35.9640, -83.9170)


def fetch(url, data=None, timeout=10):
    """(status, body bytes) or raises. POSTs JSON when data is given."""
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"user-agent": UA, **({"content-type": "application/json"} if data is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(2_000_000)
    except urllib.error.HTTPError as e:
        return e.code, e.read(10_000)


def _json(body):
    try:
        return json.loads(body)
    except (ValueError, TypeError):
        return None


def checks(base):
    """(name, core, url, data, ok(status, body) -> bool). Order is the table's order."""
    valhalla = {"locations": [{"lat": A[0], "lon": A[1]}, {"lat": B[0], "lon": B[1]}], "costing": "auto"}
    return [
        ("Site", True, base + "/", None, lambda s, b: s == 200 and b"<title>" in b),
        ("API and database", True, base + "/api/health", None, lambda s, b: s == 200 and (_json(b) or {}).get("db") is True),
        ("Routing (Valhalla)", False, "https://valhalla1.openstreetmap.de/route", valhalla,
         lambda s, b: s == 200 and "trip" in (_json(b) or {})),
        ("Routing fallback (OSRM)", False, f"https://router.project-osrm.org/route/v1/driving/{A[1]},{A[0]};{B[1]},{B[0]}?overview=false",
         None, lambda s, b: s == 200 and (_json(b) or {}).get("code") == "Ok"),
        ("Map style (OpenFreeMap)", False, "https://tiles.openfreemap.org/styles/liberty", None,
         lambda s, b: s == 200 and "layers" in (_json(b) or {})),
        ("Elevation tiles", False, "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/272/398.png", None,
         lambda s, b: s == 200 and b[:4] == b"\x89PNG"),
        ("Overpass", False, "https://overpass-api.de/api/status", None, lambda s, b: s == 200),
    ]


def run(base=BASE, get=fetch, tries=2, pause=3.0, clock=time.monotonic, sleep=time.sleep):
    """One result per check: {name, core, ok, status, ms}. status is the HTTP code, or the error's class name."""
    out = []
    for name, core, url, data, ok in checks(base):
        for attempt in range(tries):
            t0 = clock()
            try:
                status, body = get(url, data)
                good = bool(ok(status, body))
            except Exception as e:  # noqa: BLE001 - any network failure is a failed check, named in the table
                status, good = type(e).__name__, False
            ms = round((clock() - t0) * 1000)
            if good or attempt == tries - 1:
                break
            sleep(pause)
        out.append({"name": name, "core": core, "ok": good, "status": status, "ms": ms})
    return out


def summarize(results, when=None):
    """(markdown, core_ok)."""
    core_ok = all(r["ok"] for r in results if r["core"])
    deps_ok = all(r["ok"] for r in results if not r["core"])
    head = "All systems normal" if core_ok and deps_ok else ("ApexNav is up; a dependency is not" if core_ok else "ApexNav is DOWN")
    lines = [f"### {head}", "", f"Checked {when or time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}", "",
             "| Check | Kind | Result | HTTP | Time |", "|---|---|---|---|---|"]
    for r in results:
        lines.append(f"| {r['name']} | {'core' if r['core'] else 'dependency'} | {'ok' if r['ok'] else 'FAIL'} | {r['status']} | {r['ms']} ms |")
    return "\n".join(lines) + "\n", core_ok


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--base", default=BASE)
    args = p.parse_args(argv)
    results = run(args.base)
    md, core_ok = summarize(results)
    print(md)
    with open("status.json", "w", encoding="utf-8") as f:
        json.dump({"core_ok": core_ok, "failing": [r["name"] for r in results if r["core"] and not r["ok"]]}, f)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(md)
    return 0 if core_ok else 1


if __name__ == "__main__":
    sys.exit(main())
