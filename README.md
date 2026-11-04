# graph-data

Vetta's scored road network for Ohio, Kentucky and Indiana (docs/OWN_ROUTING.md on main): v1/<i>_<j>.vgr tiles
(format: tools/graph_etl/tiles.py) and v1/index.json. Built by .github/workflows/graph-region.yml; served to
the app by the Worker at /api/graph/v1/. Road data (c) OpenStreetMap contributors, ODbL 1.0: these tiles are a
derived database offered under the same licence. Elevation: Mapzen Terrain Tiles.
