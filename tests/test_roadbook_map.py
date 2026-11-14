"""web/roadbook_map.js: the Roadbooks map layer. Only books with a road in view are opened; each road drawn once."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(js):
    src = f"const M = require({json.dumps(str(ROOT / 'web' / 'roadbook_map.js'))}); console.log(JSON.stringify({js}));"
    return json.loads(subprocess.run(["node", "-e", src], capture_output=True, text=True, check=True).stdout)


BOOKS = [
    {"id": "A", "road_list": [{"box": [35.4, 35.5, -84.0, -83.9]}]},
    {"id": "B", "road_list": [{"box": [39.0, 39.1, -84.6, -84.5]}, {"box": None}]},
    {"id": "C", "road_list": []},
    {"id": "D", "road_list": [{"box": [35.49, 35.6, -83.95, -83.8]}]},
]


def test_in_view_lists_the_books_with_a_road_that_touches_the_view():
    assert run(f"M.inView({json.dumps(BOOKS)}, [35.45, 35.55, -83.97, -83.85])") == ["A", "D"]
    assert run(f"M.inView({json.dumps(BOOKS)}, [39.05, 39.2, -84.55, -84.4])") == ["B"]
    assert run(f"M.inView({json.dumps(BOOKS)}, [10, 11, 10, 11])") == []
    assert run(f"M.inView({json.dumps(BOOKS)}, null)") == []
    assert run("M.inView(null, [0, 1, 0, 1])") == []


def test_features_draw_each_road_once_with_driven_marked():
    full = """new Map([
      ['A', { road_list: [{ id: 'r1', name: 'The Dragon', geom: [[-83.9, 35.4], [-83.91, 35.41]], stamped: true },
                          { id: 'r2', name: 'Short', geom: [[-83.9, 35.4]] }] }],
      ['D', { road_list: [{ id: 'r1', name: 'The Dragon', geom: [[-83.9, 35.4], [-83.91, 35.41]] },
                          { id: 'r3', name: 'Cherohala', geom: [[-84.1, 35.3], [null, 1], [-84.0, 35.31]] }] }]])"""
    fc = run(f"M.features({full})")
    assert fc["type"] == "FeatureCollection"
    assert [(f["properties"]["book"], f["properties"]["name"], f["properties"]["d"], len(f["geometry"]["coordinates"])) for f in fc["features"]] == [
        ("A", "The Dragon", 1, 2), ("D", "Cherohala", 0, 2)]
    assert run("M.features(null).features") == []


def test_the_layer_is_wired_off_by_default_and_lazy():
    html = (ROOT / "web" / "index.html").read_text()
    js = (ROOT / "web" / "cockpit.js").read_text()
    lazy = (ROOT / "web" / "lazy.js").read_text()
    assert 'data-toggle="roadbooks"' in html and "roadbooks: false" in js
    assert "'roadbook_map.js'" in lazy and "<script src=\"roadbook_map.js\"" not in html   # with the social scripts, never at launch
    assert "ApexRoadbookMap.mount" in js and "roadbookMap.restyle()" in js
