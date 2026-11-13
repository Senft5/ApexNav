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


def test_states_are_the_lower_48_only():
    assert list(U.states(INDEX)) == ["ohio", "west-virginia"]


def test_geofabriks_us_prefixed_ids_are_states_by_their_short_names():
    ix = {"features": [{"properties": {"id": "us/ohio", "parent": "us", "urls": {"pbf": "https://x/ohio.pbf"}}, "geometry": box(-84.82, 38.4, -80.52, 42.33)},
                       {"properties": {"id": "us/alaska", "parent": "us"}, "geometry": box(-179.2, 51.2, -129.9, 71.4)}]}
    assert list(U.states(ix)) == ["ohio"]
    assert U.urls(ix)["ohio"] == "https://x/ohio.pbf"


def test_jobs_cover_each_block_once_with_the_states_under_its_margin():
    js = U.jobs(U.states(INDEX))
    names = [b[0] for j in js for b in j["blocks"]]
    assert len(names) == len(set(names)), "no block in two jobs"
    boxes = {tuple(b[1]) for j in js for b in j["blocks"]}
    assert (-85.0, 38.0, -84.0, 39.0) in boxes and (-78.0, 37.0, -77.0, 38.0) in boxes
    assert (-90.0, 38.0, -89.0, 39.0) not in boxes, "no state there: no block"
    for j in js:
        assert j["east"] - j["west"] <= U.CHUNK_DEG
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
    import yaml
    wf = yaml.safe_load(open(os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "graph-us.yml")))
    jobs = wf["jobs"]
    assert jobs["band"]["needs"] == ["plan", "osm"] and jobs["publish"]["needs"] == ["plan", "band"]
    steps = jobs["publish"]["steps"]
    names = [s.get("name") for s in steps]
    rel, ptr = names.index("The release"), names.index("Point the Worker at it")
    assert rel < ptr == len(steps) - 1
    assert steps[ptr]["if"] == "needs.plan.outputs.live == 'true'"
    run = steps[rel]["run"]
    assert "for f in packs/*.bin packs/index.json packs/packs.json; do" in run, "indexes after the packs"
    plan = jobs["plan"]["steps"][-1]["run"]
    assert '[ -z "$only" ] && live=true' in plan, "the whole country goes live; a pilot only when asked"
