"""Our own camera list for the region (tools/graph_etl/cameras.py, .github/workflows/cameras.yml): plate readers and speed
cameras from the extracts, and the 0.25 degree tiles the extracts hold whole (a tile not listed is unknown, never empty)."""
import json

from tools.graph_etl import cameras as C

# a 1 x 1 degree square state from 39..40 N, -85..-84 W, with a hole of one tile cut out of its middle corner
POLY = """square
1
   -85.0 39.0
   -84.0 39.0
   -84.0 40.0
   -85.0 40.0
   -85.0 39.0
END
!2
   -84.5 39.5
   -84.25 39.5
   -84.25 39.75
   -84.5 39.75
END
END
"""


def feat(lon, lat, **tags):
    return "\x1e" + json.dumps({"type": "Feature", "id": f"n{len(tags)}{lon}{lat}", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": tags}) + "\n"


def test_the_poly_outline_and_its_hole():
    rings = C.parse_poly(POLY)
    assert [h for _, h in rings] == [False, True]
    assert C.in_poly(-84.9, 39.1, rings) and not C.in_poly(-84.4, 39.6, rings) and not C.in_poly(-83.9, 39.1, rings)


def test_only_tiles_held_whole_are_covered():
    tiles = C.covered_tiles([C.parse_poly(POLY)])
    # 16 tiles in the square; the hole's tile is out, and none outside the square
    assert len(tiles) == 15
    assert "158_-338" not in tiles               # 39.5..39.75, -84.5..-84.25: the hole
    assert "156_-340" in tiles and "159_-337" in tiles
    assert "160_-340" not in tiles and "156_-336" not in tiles


def test_cameras_kept_by_kind_and_tile():
    lines = [feat(-84.9, 39.1, **{"surveillance:type": "ALPR", "man_made": "surveillance"}), feat(-84.8, 39.2, highway="speed_camera"),
             feat(-84.7, 39.3, amenity="police"), feat(-83.5, 39.1, **{"surveillance:type": "ALPR"}),   # not a camera; off the map
             feat(-84.4, 39.6, highway="speed_camera"), "\n"]                                             # in the hole: not known
    doc = C.region([C.parse_poly(POLY)], lines, "2026-46", "test")
    assert doc["cams"] == [[39.1, -84.9, "a"], [39.2, -84.8, "s"]]
    assert doc["tile"] == 0.25 and doc["version"] == 1 and doc["build"] == "2026-46"
