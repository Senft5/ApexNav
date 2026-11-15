"""The lower-48 graph build (tools/graph_etl/us_plan.py, pack.py; .github/workflows/graph-us.yml): the jobs cover every
block a state touches once, fetch only the states under each block's margin, and the packs hold every tile byte for
byte at the offsets packs.json gives."""
import json
import os

from tools.graph_etl import pack as P
from tools.graph_etl import us_plan as U


def box(w, s, e, n):
    return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


INDEX = {"features": [
    {"properties": {"id": "ohio", "parent": "us"}, "geometry": box(-84.82, 38.4, -80.52, 42.33)},
    {"properties": {"id": "west-virginia", "parent": "us"}, "geometry": box(-82.65, 37.2, -77.72, 40.64)},
    {"properties": {"id": "alaska", "parent": "us"}, "geometry": box(-179.2, 51.2, -129.9, 71.4)},
    {"properties": {"id": "puerto-rico", "parent": "us"}, "geometry": box(-67.95, 17.88, -65.22, 18.52)},
    {"properties": {"id": "ontario", "parent": "canada"}, "geometry": box(-95.2, 41.6, -74.3, 56.9)},
]}


def test_states_are_the_lower_48_alaska_and_hawaii_not_the_territories():
    assert list(U.states(INDEX)) == ["alaska", "ohio", "west-virginia"]
    assert U.states(INDEX)["alaska"] == U.EXTRA["alaska"], "Alaska by its road boxes, not its outline across the date line"


def test_alaska_and_hawaii_are_built_where_their_roads_are():
    """2026-11-15: Fun had no road in Alaska or Hawaii (the build was the lower 48's). Their own boxes: Alaska's outline
    runs across the date line and Hawaii's out to Midway, so their blocks are where the roads are."""
    ix = {"features": [{"properties": {"id": "us/hawaii", "parent": "us"}, "geometry": box(-178.5, 18.8, -154.7, 28.5)},
                       {"properties": {"id": "us/alaska", "parent": "us"}, "geometry": box(-179.2, 51.2, 179.8, 71.4)},
                       {"properties": {"id": "us/ohio", "parent": "us"}, "geometry": box(-84.82, 38.4, -80.52, 42.33)}]}
    st = U.states(ix)
    assert sorted(st) == ["alaska", "hawaii", "ohio"]
    js = U.jobs(st, only={"alaska", "hawaii"})
    boxes = {tuple(b[1]) for j in js for b in j["blocks"]}
    for lon, lat, where in ((-149.9, 61.2, "Anchorage"), (-147.7, 64.8, "Fairbanks"), (-148.4, 70.3, "Prudhoe Bay"),
                            (-165.4, 64.5, "Nome"), (-166.5, 53.9, "Unalaska"), (-134.4, 58.3, "Juneau"),
                            (-131.6, 55.3, "Ketchikan"), (-157.9, 21.3, "Honolulu"), (-156.0, 20.8, "Hana"),
                            (-155.1, 19.7, "Hilo"), (-159.4, 22.0, "Kauai")):
        assert any(b[0] <= lon < b[2] and b[1] <= lat < b[3] for b in boxes), where
    assert all(b[0] >= -167.0 for b in boxes), "nothing past the date line"
    assert not any(b[0] >= -141.0 and b[1] >= 61.0 for b in boxes), "the Yukon is Canada's"
    assert not any(b[1] >= 23.0 and b[3] <= 30.0 for b in boxes), "no blocks out to Midway"
    assert len(boxes) < 650 and len(js) <= 60
    assert all("ohio" not in j["states"] for j in js) and all(j["states"] in (["alaska"], ["hawaii"]) for j in js)
    # the lower 48 alone is planned as before
    lower = U.jobs(st, only={"ohio"})
    assert all(-125.0 <= b[1][0] and b[1][1] >= 24.0 for j in lower for b in j["blocks"])


def test_the_pacific_northwest_is_in_though_its_polygons_run_out_to_sea():
    """2026-11-14: Geofabrik's Washington reaches -126.7 and Oregon past -126; at 1 degree of slack the first build left both
    out (Seattle, Portland, the Oregon coast off the map)."""
    ix = {"features": [{"properties": {"id": "us/washington", "parent": "us"}, "geometry": box(-126.74, 45.54, -116.91, 49.05)},
                       {"properties": {"id": "us/oregon", "parent": "us"}, "geometry": box(-126.11, 41.99, -116.46, 46.30)},
                       {"properties": {"id": "us/hawaii", "parent": "us"}, "geometry": box(-178.5, 18.8, -154.7, 28.5)},
                       {"properties": {"id": "us/alaska", "parent": "us"}, "geometry": box(-179.2, 51.2, -129.9, 71.4)}]}
    assert list(U.states(ix)) == ["alaska", "hawaii", "oregon", "washington"]
    boxes = {tuple(b[1]) for j in U.jobs(U.states(ix), only={"oregon", "washington"}) for b in j["blocks"]}
    assert (-123.0, 47.0, -122.0, 48.0) in boxes and (-124.0, 45.0, -123.0, 46.0) in boxes, "Seattle and the Oregon coast"
    assert all(b[0] >= -125.0 for b in boxes), "blocks stay on the lower 48's grid"


def test_geofabriks_us_prefixed_ids_are_states_by_their_short_names():
    ix = {"features": [{"properties": {"id": "us/ohio", "parent": "us", "urls": {"pbf": "https://x/ohio.pbf"}}, "geometry": box(-84.82, 38.4, -80.52, 42.33)},
                       {"properties": {"id": "us/alaska", "parent": "us"}, "geometry": box(-179.2, 51.2, -129.9, 71.4)}]}
    assert list(U.states(ix)) == ["alaska", "ohio"]
    assert U.urls(ix)["ohio"] == "https://x/ohio.pbf"


def test_jobs_cover_each_block_once_with_the_states_under_its_margin():
    js = U.jobs(U.states(INDEX))
    names = [b[0] for j in js for b in j["blocks"]]
    assert len(names) == len(set(names)), "no block in two jobs"
    boxes = {tuple(b[1]) for j in js for b in j["blocks"]}
    assert (-85.0, 38.0, -84.0, 39.0) in boxes and (-78.0, 37.0, -77.0, 38.0) in boxes
    assert (-90.0, 38.0, -89.0, 39.0) not in boxes, "no state there: no block"
    for j in js:
        assert j["east"] - j["west"] <= U.chunk_deg(j["band"], j["west"])
        assert not j["west"] < U.DENSE_WEST < j["east"], "no chunk across the dense line"
        for _, b, clip in j["blocks"]:
            assert clip == [b[0] - 0.4, b[1] - 0.4, b[2] + 0.4, b[3] + 0.4] or tuple(clip) == (b[0] - 0.4, b[1] - 0.4, b[2] + 0.4, b[3] + 0.4)
    # a job fetches the states under its blocks' margins: by the river both, on Lake Erie only Ohio
    by = {tuple(b[1]): j["states"] for j in js for b in j["blocks"]}
    assert by[(-81.0, 39.0, -80.0, 40.0)] == ["ohio", "west-virginia"]
    assert by[(-84.0, 42.0, -83.0, 43.0)] == ["ohio"]


def test_a_pilot_builds_only_its_states_blocks_but_fetches_their_neighbours():
    js = U.jobs(U.states(INDEX), only={"west-virginia"})
    boxes = {tuple(b[1]) for j in js for b in j["blocks"]}
    assert (-84.0, 41.0, -83.0, 42.0) not in boxes
    assert any("ohio" in j["states"] for j in js), "a West Virginia block by the river reads Ohio's side too"


def test_the_matrix_round_trips_to_block_lines(capsys, tmp_path):
    p = tmp_path / "index.json"
    p.write_text(json.dumps(INDEX))
    U.main(["matrix", "--index", str(p), "--only", "ohio"])
    m = json.loads(capsys.readouterr().out)
    job = m["include"][0]
    U.main(["blocks", "--job", job["job"]])
    lines = capsys.readouterr().out.strip().splitlines()
    assert lines and all(len(x.split()) == 3 for x in lines)
    assert job["states"].split()


def test_packs_hold_every_tile_at_its_offset(tmp_path):
    src, out = tmp_path / "m", tmp_path / "o"
    src.mkdir()
    tiles = {"400_520": b"VGR1" + bytes(range(20)), "401_527": b"VGR1xyz", "408_520": b"VGR1" + b"\x07" * 9}
    for k, b in tiles.items():
        (src / f"{k}.vgr").write_bytes(b)
    (src / "index.json").write_text(json.dumps({"version": 3, "build": "b9", "tiles": {k: {"bytes": len(b), "edges": 3} for k, b in tiles.items()}}))
    r = P.pack(str(src), str(out))
    assert r == {"packs": 2, "tiles": 3, "bytes": sum(len(b) for b in tiles.values()), "build": "b9"}
    packs = json.loads((out / "packs.json").read_text())
    assert packs["build"] == "b9"
    for k, b in tiles.items():
        name, off, n = packs["tiles"][k]
        assert name == P.pack_of(k) and (out / name).read_bytes()[off:off + n] == b
    assert packs["tiles"]["400_520"][0] == packs["tiles"]["401_527"][0] != packs["tiles"]["408_520"][0]
    ix = json.loads((out / "index.json").read_text())
    assert ix["build"] == "b9" and ix["tiles"] == {k: {"bytes": len(b)} for k, b in tiles.items()}
    assert sorted(os.listdir(out)) == ["index.json", "p50_65.bin", "p51_65.bin", "packs.json"]


def test_the_workflow_moves_the_pointer_last_and_only_for_a_whole_build():
    # Plain text checks: CI's Python has no PyYAML.
    wf = open(os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "graph-us.yml")).read()
    assert "needs: [plan, osm, osm-again]" in wf and "needs: [plan, band]" in wf
    pub = wf[wf.index("\n  publish:"):]
    rel, ptr = pub.index("name: The release"), pub.index("name: Point the Worker at it")
    assert rel < ptr and "- name:" not in pub[ptr + 10:], "the pointer is the last step"
    assert "if: needs.plan.outputs.live == 'true'" in pub[ptr:]
    assert "for f in packs/*.bin packs/index.json packs/packs.json; do" in pub[rel:ptr], "indexes after the packs"
    assert '[ -z "$only" ] && live=true' in wf, "the whole country goes live; a pilot only when asked"


def test_the_lower_48_goes_live_in_our_bucket_under_its_own_build_name():
    wf = open(os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "graph-us.yml")).read()
    assert '--build "us-${{ needs.plan.outputs.week }}"' in wf, "never the region's build id: R2 keys and edge caches are per build"
    pub = wf[wf.index("\n  publish:"):]
    assert "id-token: write" in pub
    ptr = pub[pub.index("name: Point the Worker at it"):]
    assert ptr.index("upload_r2.sh merged") < ptr.index("publish_data.sh ptr"), "R2 first: the Worker reads its index before a release"
    assert "set -o pipefail" in ptr
    assert "cp packs/index.json merged/v1/index.json" in pub
    mp = pub[pub.index("name: Merge and pack"):pub.index("name: The release")]
    assert mp.index("set -o pipefail") < mp.index("merge_index"), "a refused merge fails its step, not tee's"


def test_the_region_mirror_never_shrinks_a_live_lower_48(tmp_path):
    import subprocess, json as _j, http.server, threading
    sh = os.path.join(os.path.dirname(__file__), "..", "tools", "graph_etl", "upload_r2.sh")
    (tmp_path / "v1").mkdir()
    (tmp_path / "v1" / "index.json").write_text(_j.dumps({"build": "2026-46-abc", "tiles": {"1_1": {}}}))
    (tmp_path / "v1" / "1_1.vgr").write_bytes(b"x")
    seen = []

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = _j.dumps({"build": "us-2026-46-abc", "tiles": {}}).encode()
            self.send_response(200); self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)

        def do_PUT(self):
            seen.append(self.path); self.send_response(201); self.end_headers()

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    env = {**os.environ, "NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1"}
    out = subprocess.run(["bash", sh, str(tmp_path), f"http://127.0.0.1:{srv.server_port}"], capture_output=True, text=True, env=env, timeout=60)
    srv.shutdown()
    assert out.returncode == 0, out.stderr
    assert "is not mirrored over it" in out.stdout and seen == []


def test_a_state_geofabrik_refused_is_fetched_again_on_another_runner():
    """2026-11-14: Geofabrik refused one runner every try for 25 min (district-of-columbia) while the others downloaded; the
    whole build waited on it and failed. The state's own job goes on without it; osm-again (a fresh runner) fetches the ones
    with no artifact, and a band takes the state from there."""
    wf = open(os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "graph-us.yml")).read()
    osm = wf[wf.index("\n  osm:"):wf.index("\n  osm-again:")]
    assert "continue-on-error: true" in osm and "if: steps.get.outcome == 'success'" in osm, "a refused state fails no job, uploads nothing"
    again = wf[wf.index("\n  osm-again:"):wf.index("\n  band:")]
    assert "needs: [plan, osm]" in again and "actions: read" in again
    assert 'grep -qx "osm-$st"' in again and "name: osm-again" in again
    band = wf[wf.index("\n  band:"):wf.index("\n  publish:")]
    assert "-n osm-again" in band and 'echo "::error::no extract for $s"; exit 1' in band, "no extract either way: the band fails, never builds without the state"


def test_the_dense_east_is_cut_finer_and_the_matrix_fits():
    """2026-11-14: the -95..-80 chunks (Chicago, Detroit, Cleveland) took up to 4 h 17 min of the 5 h 45 min limit. East of
    -100 the chunks are 8 degrees (whole ones: the blocks stay on the grid); the lower 48 whole is still under GitHub's 256 jobs a matrix."""
    full = {f"s{i}": (-125.0 + i, 24.0, -124.0 + i, 50.0) for i in range(59)}
    assert len(U.jobs({**full, **U.EXTRA})) <= 256, "Alaska and Hawaii beside every block of the lower 48"
    js = U.jobs(full)
    assert len(js) <= 256
    assert all(float(b[1][0]).is_integer() for j in js for b in j["blocks"]), "every block on whole degrees"
    assert {(j["west"], j["east"]) for j in js if j["west"] >= -100 and j["band"] == 35} == {(-100.0, -92.0), (-92.0, -84.0), (-84.0, -76.0), (-76.0, -68.0), (-68.0, -66.0)}
    # the Great Lakes belt in 4 degree chunks (42_-92 at 8 degrees: past 3 h 45 min)
    assert {(j["west"], j["east"]) for j in js if j["band"] == 42 and -92 <= j["west"] < -76} == {(-92.0, -88.0), (-88.0, -84.0), (-84.0, -80.0), (-80.0, -76.0)}
    assert {(j["west"], j["east"]) for j in js if j["band"] == 39 and -92 <= j["west"] < -76} == {(-92.0, -84.0), (-84.0, -76.0)}


def test_a_publish_can_take_an_earlier_runs_bands():
    """2026-11-14: all 141 bands of the lower 48 built (13 h) and the publish runner died in the spot check, which decoded
    every tile at once. bands_from publishes an earlier run's band artifacts with no download and no band."""
    wf = open(os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "graph-us.yml")).read()
    for job in ("osm", "osm-again", "band"):
        part = wf[wf.index(f"\n  {job}:"):]
        assert part.index("needs.plan.outputs.reuse == ''") < part.index("steps:"), job
    pub = wf[wf.index("\n  publish:"):]
    assert "needs.plan.outputs.reuse != '' && needs.band.result == 'skipped'" in pub
    # download-artifact sees only 100 of another run's artifacts (100 of 141 bands went live, 2026-11-14): by id, paginated
    assert "run-id:" not in pub
    assert 'gh api --paginate "repos/${{ github.repository }}/actions/runs/$RUN/artifacts?per_page=100"' in pub
    assert "not every band of run $RUN has its artifact" in pub
    # several runs (2026-11-15: a pilot's Alaska and Hawaii beside the lower 48's bands), each whole or refused
    assert 'for RUN in ${RUNS//,/ }; do' in pub
    plan = wf[wf.index("\n  plan:"):wf.index("\n  osm:")]
    assert '*[!0-9,]*|,*|*,|*,,*' in plan
    assert "python -m tools.graph_etl.check" not in pub, "the spot roads are Cincinnati's: graph-region.yml checks them"


def test_a_rescore_takes_an_earlier_runs_extracts():
    """2026-11-15: the lower-48 context grid went live after the bands were built. osm_from rebuilds and rescores the
    bands from an earlier run's OSM artifacts, with no new Geofabrik download."""
    wf = open(os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "graph-us.yml")).read()
    assert "osm_from:" in wf
    for job in ("osm", "osm-again"):
        part = wf[wf.index(f"\n  {job}:"):]
        assert part.index("inputs.osm_from == ''") < part.index("steps:"), job
    band = wf[wf.index("\n  band:"):]
    assert band.index("inputs.osm_from != '' && needs.osm-again.result == 'skipped'") < band.index("steps:")
    assert "needs.plan.outputs.osmrun" in band
    assert "github.run_id" not in band[band.index("gh run download"):band.index("gh run download") + 400]


def test_a_reused_publish_never_asks_geofabrik():
    """2026-11-14: Geofabrik refused the plan runner of the first bands_from run, which needs nothing from it."""
    wf = open(os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "graph-us.yml")).read()
    plan = wf[wf.index("\n  plan:"):wf.index("\n  osm:")]
    assert plan.index('if [ -n "$IN_BANDS" ]; then') < plan.index("download.geofabrik.de/index-v1.json")
    assert "--retry-max-time 1500" in plan


def test_the_lower_48_is_rebuilt_monthly_and_goes_live():
    wf = open(os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "graph-us.yml")).read()
    assert 'cron: "23 3 1 * *"' in wf, "the 1st of each month (day of month and day of week together would be either)"
    assert '[ -z "$only" ] && live=true' in wf, "a scheduled run has no inputs: the whole country, live"


def test_bands_that_differ_only_in_their_grid_cut_merge_as_one_build(tmp_path):
    """2026-11-15: the first rescore with the lower 48's grid built all 141 bands and the publish refused them, each
    band's build id carrying the hash of its own cut of the grid's index. Ids that differ only in that tag are one
    build; a different road build is still refused."""
    from tools.graph_etl import merge_index as M
    assert M.same_build({"us-2026-46-abc-g000001"}) == "us-2026-46-abc-g000001"
    one = M.same_build({"us-2026-46-abc-g000001", "us-2026-46-abc-g0000ff"})
    assert one.startswith("us-2026-46-abc-g") and len(one) == len("us-2026-46-abc-g000001")
    assert M.same_build({"us-2026-46-abc-g000001", "us-2026-47-abc-g000001"}) is None
    for k, b in enumerate(("us-2026-46-abc-g000001", "us-2026-46-abc-g0000ff")):
        d = tmp_path / f"b{k}"
        d.mkdir()
        (d / f"t{k}.vgr").write_bytes(b"x")
        (d / "index.json").write_text(json.dumps({"build": b, "model": "m", "tiles": {f"t{k}": {"bytes": 1}}}))
    ix = M.merge(str(tmp_path / "out"), [str(tmp_path / "b0"), str(tmp_path / "b1")])
    assert ix["build"] == one and ix["tile_count"] == 2


def test_a_bands_grid_cut_carries_its_releases_id(tmp_path):
    """The cut of the grid a band fetches names the whole release, so build.py ctx_tag gives every band one tag."""
    from tools.graph_etl import build as B
    for k in range(2):
        d = tmp_path / f"c{k}"
        d.mkdir()
        (d / "index.json").write_text(json.dumps({"region": "us", "bundles": {f"{k}/1": {}}, "release": "a1b2c3d4e5f6"}))
    assert B.ctx_tag(str(tmp_path / "c0")) == B.ctx_tag(str(tmp_path / "c1")) == "-ga1b2c3"
    src = open(os.path.join(os.path.dirname(__file__), "..", "tools", "ctx_etl", "fetch.py")).read()
    assert "release=hashlib.sha1(" in src
