"""web/meets_map.js (IDEAS S-13): the Meets layer's pins. One pin per meeting point, soonest first, the day on the pin."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(js):
    src = f"const M = require({json.dumps(str(ROOT / 'web' / 'meets_map.js'))}); console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run(["node", "-e", src], capture_output=True, text=True, check=True, env={"TZ": "UTC", "PATH": "/usr/bin:/usr/local/bin:/bin"}).stdout)


def test_pin_text_says_the_day():
    now = "new Date('2026-11-12T08:00:00Z')"
    assert run(f"M.pinText('2026-11-12T18:00:00Z', {now}, 'en-US')") == "Today"
    assert run(f"M.pinText('2026-11-13T09:00:00Z', {now}, 'en-US')") == "Tmrw"
    assert run(f"M.pinText('2026-11-14T09:00:00Z', {now}, 'en-US')") == "Sat"
    assert run(f"M.pinText('nope', {now})") == "--"


def test_pins_group_by_place_soonest_first():
    rows = [
        {"id": "b", "starts_at": "2026-11-15T09:00:00Z", "meet_lat": 35.47, "meet_lon": -83.92},
        {"id": "a", "starts_at": "2026-11-14T09:00:00Z", "meet_lat": 35.4701, "meet_lon": -83.9201},
        {"id": "c", "starts_at": "2026-11-13T09:00:00Z", "meet_lat": 35.60, "meet_lon": -83.50},
        {"id": "x", "starts_at": "2026-11-13T09:00:00Z", "meet_lat": None, "meet_lon": -83.5},
        {"id": "y", "starts_at": "never", "meet_lat": 35.6, "meet_lon": -83.5},
    ]
    out = run(f"M.pins({json.dumps(rows)}).map((p) => p.meets.map((m) => m.id))")
    assert out == [["c"], ["a", "b"]]
    assert run("M.pins(null)") == []


def test_pins_are_capped():
    rows = [{"id": str(i), "starts_at": "2026-11-14T09:00:00Z", "meet_lat": 35 + i * 0.01, "meet_lon": -84} for i in range(30)]
    assert run(f"M.pins({json.dumps(rows)}).length") == run("M.MAX_PINS") == 20


def test_layer_is_wired_and_lazy():
    cockpit = (ROOT / "web" / "cockpit.js").read_text()
    assert "meets: false" in cockpit and "ApexMeetsMap.mount" in cockpit
    assert "'meets_map.js'" in (ROOT / "web" / "lazy.js").read_text()
    assert 'data-toggle="meets"' in (ROOT / "web" / "index.html").read_text()
    src = (ROOT / "web" / "meets_map.js").read_text()
    assert "cellQuery" in src and "mayLookUp" in src      # VI-1: the cell, never the point, never from a privacy zone
