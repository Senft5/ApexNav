# graph-data

Data for Vetta's own routing in Ohio, Kentucky and Indiana (docs/OWN_ROUTING.md on main), served to the app by the
Worker. Nothing here is code; every commit is a CI build.

- `v1/`: the scored road network, `<i>_<j>.vgr` tiles (format: tools/graph_etl/tiles.py) and `index.json`. Built by
  .github/workflows/graph-region.yml; served at `/api/graph/v1/`.
- `ctx/v1/`: the context-grid bundles (`8/<x>/<y>.vcg`, format: tools/ctx_etl/vcg.py) and `index.json`. Built by
  .github/workflows/ctx-region.yml; served at `/api/ctx/v1/`.
- `cameras/v1/region.json`: plate readers and fixed speed cameras for Avoid cameras (tools/graph_etl/cameras.py). Built
  weekly by .github/workflows/cameras.yml; served at `/api/cameras/v1/region.json`.

Road data (c) OpenStreetMap contributors, ODbL 1.0: the tiles are a derived database offered under the same licence.
Elevation: Mapzen Terrain Tiles. The context grid's sources and licences are listed in its index.json (public data:
NLCD, Census, BTS noise, NASA Black Marble, HPMS, FARS, FEMA, USDA CDL, NPS, OpenAddresses).
