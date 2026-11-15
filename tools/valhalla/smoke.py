"""Real questions for our Valhalla router, the kinds the app asks (web/cockpit.js), all inside the region.
Fails (exit 1) when any goes unanswered. .github/workflows/valhalla-tiles.yml runs it on every tile build.

    python tools/valhalla/smoke.py http://localhost:8002
"""
import json
import sys
import time
import urllib.error
import urllib.request

CINCY = {"lat": 39.1031, "lon": -84.5120}
LEXINGTON = {"lat": 38.0406, "lon": -84.5037}
COLUMBUS = {"lat": 39.9612, "lon": -82.9988}
INDY = {"lat": 39.7684, "lon": -86.1581}
LOUISVILLE = {"lat": 38.2527, "lon": -85.7585}
AUTO = {"costing": "auto", "costing_options": {"auto": {"use_highways": 0.15, "use_tolls": 0.3}}}


def ask(base: str, action: str, body: dict) -> tuple[dict, float]:
    t0 = time.monotonic()
    req = urllib.request.Request(f"{base}/{action}", data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{action}: HTTP {e.code} {e.read()[:300]!r}")
    return out, time.monotonic() - t0


def main(base: str) -> int:
    rows = []
    for a, b, name in [(CINCY, LEXINGTON, "Cincinnati to Lexington"), (COLUMBUS, INDY, "Columbus to Indianapolis"), (LOUISVILLE, CINCY, "Louisville to Cincinnati")]:
        j, s = ask(base, "route", {"locations": [a, b], **AUTO, "alternates": 2, "turn_lanes": True})
        km = j["trip"]["summary"]["length"]
        assert km > 50, f"{name}: {km} km"
        print(f"- route {name}: {km:.0f} km, {s:.2f} s", flush=True)
        rows.append(f"route {name}: {km:.0f} km, {len(j.get('alternates') or [])} alternates, {s:.2f} s")
        if name.startswith("Cincinnati"):
            shape = j["trip"]["legs"][0]["shape"]
    # the app's matrices: a crew's members or a plan's stages, within an hour or so of each other (web/cockpit.js valhallaMatrix)
    near = [{"lat": CINCY["lat"] + dy, "lon": CINCY["lon"] + dx} for dy, dx in
            [(0.3, 0), (-0.3, 0), (0, 0.4), (0, -0.4), (0.25, 0.3), (-0.25, -0.3), (0.5, 0.5), (-0.5, 0.4), (0.4, -0.6), (0.1, 0.8), (-0.1, -0.8), (0.6, 0), (-0.6, 0)]]
    j, s = ask(base, "sources_to_targets", {"sources": [CINCY, near[0], near[6]], "targets": near, **AUTO})
    cells = [c for row in j["sources_to_targets"] for c in row]
    holes = [c for c in cells if not c.get("time")]
    assert not holes, f"matrix has {len(holes)} holes: {json.dumps(holes)[:600]}"
    rows.append(f"sources_to_targets 3x13 round Cincinnati: {s:.2f} s")
    # cities 200-340 km apart: our matrix may leave such pairs empty, and then the app asks the public server (route_loading.js)
    j, s = ask(base, "sources_to_targets", {"sources": [CINCY, COLUMBUS], "targets": [LEXINGTON, INDY, LOUISVILLE], **AUTO})
    holes = sum(1 for row in j["sources_to_targets"] for c in row if not c.get("time"))
    rows.append(f"sources_to_targets 2x3 between cities: {holes} of 6 empty, {s:.2f} s (not a failure)")
    j, s = ask(base, "trace_attributes", {"encoded_polyline": shape, "costing": "auto", "shape_match": "map_snap",
                                         "filters": {"action": "include", "attributes": ["edge.speed_limit", "edge.road_class", "edge.way_id"]}})
    assert len(j.get("edges") or []) > 20, "trace_attributes found no edges"
    rows.append(f"trace_attributes ({len(j['edges'])} edges): {s:.2f} s")
    j, s = ask(base, "trace_route", {"encoded_polyline": shape, "costing": "auto", "shape_match": "map_snap"})
    assert j["trip"]["legs"][0]["maneuvers"], "trace_route gave no maneuvers"
    rows.append(f"trace_route ({len(j['trip']['legs'][0]['maneuvers'])} maneuvers): {s:.2f} s")
    print("\n".join(f"- {r}" for r in rows))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1].rstrip("/")))
