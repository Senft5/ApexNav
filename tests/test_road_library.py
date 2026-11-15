"""web/data/road_library.json (tools/road_library.js, big bet #6): the roads on vettadrive.app/roads.

Every road is a named road from our graph, in a listed area, with its length, its corners and its line; its id is a
page address; its Drive it in Vetta link is a road link the app opens (web/road_link.js)."""
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = json.load(open(os.path.join(ROOT, "web", "data", "road_library.json"), encoding="utf-8"))


def test_every_road_is_whole_and_in_a_listed_area():
    areas = {a["id"]: a for a in LIB["areas"]}
    assert len(LIB["roads"]) >= 100 and len(areas) >= 50
    ids = [r["id"] for r in LIB["roads"]]
    assert len(ids) == len(set(ids))
    for r in LIB["roads"]:
        assert re.fullmatch(r"[a-z0-9-]{1,80}", r["id"]) and not re.fullmatch(r"[a-z]{2}", r["id"]), r["id"]   # never a state's page
        assert r["area"] in areas and r["name"].strip()
        assert r["km"] >= 5 and isinstance(r["corners"], int) and r["corners"] > 0
        assert len(r["line"]) >= 20 and all(-90 <= la <= 90 and -180 <= lo <= 180 for la, lo in r["line"])
        a = areas[r["area"]]
        la, lo = r["line"][0]
        assert abs(la - a["lat"]) < 1.5 and abs(lo - a["lon"]) < 1.8, r["id"]   # within the area's reach


def test_drive_it_links_open_the_road():
    links = [(r["link"], r["name"]) for r in LIB["roads"] if r["link"]]
    assert len(links) >= 0.9 * len(LIB["roads"])
    js = ("const L = require('./web/road_link.js'); const xs = JSON.parse(process.argv[1]);"
          "console.log(JSON.stringify(xs.map(([t]) => { const d = L.decode(t); return d && [d.pts.length, d.name]; })))")
    out = json.loads(subprocess.run(["node", "-e", js, json.dumps(links[:40])], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    for (tok, name), d in zip(links[:40], out):
        assert d and d[0] >= 2, tok
        assert d[1] and name.startswith(d[1][:20])


def test_no_two_pages_for_one_road():
    seen = {}
    for r in LIB["roads"]:
        for e in (r["line"][0], r["line"][-1]):
            key = (r["name"], round(e[0], 2), round(e[1], 2))
            assert seen.get(key, r["id"]) == r["id"], (r["id"], seen[key])   # (a loop road's two ends may be one place)
            seen[key] = r["id"]
