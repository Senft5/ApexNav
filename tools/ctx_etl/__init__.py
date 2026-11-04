"""Vetta's context grid: national/public datasets preprocessed into compact per-region bundles the phone reads locally.

Run (from the repo root):

    pip install -r tools/ctx_etl/requirements.txt
    python -m tools.ctx_etl.build --preset cincinnati            # the five counties around Cincinnati (committed)
    python -m tools.ctx_etl.build --preset launch --out ctx_out    # the seven-state launch region (the GitHub workflow)

Modules:
- grid.py        web-mercator grid, the bundle/tile scheme and every channel's spec (cell size, dtype, scale, unit, source)
- vcg.py         the bundle file format (writer and reader), pure Python
- transforms.py  the pure transforms (quantising, block reductions, palette decoding, flood classes, densities, lines)
- sources.py     the downloads (network, cached), one function per dataset
- build.py       the command line: region -> bundles

The phone side is web/route_ctx/context_grid.js; tests are tests/test_ctx_etl.py and tests/test_route_ctx_context_grid.py.
"""
