"""OSM extract -> Vetta's drivable graph (docs/OWN_ROUTING.md §2): ways, nodes, oneway, access, turn restrictions,
degree-2 chains merged into edges, the point features on them, side roads and driveways joining them, businesses and
buildings beside them, land use, water. Pure Python over pyosmium; no scoring here (that is web/route_engine.js, run by
tools/graph_etl/score_edges.js).

Unknown stays unknown: a tag that isn't there is None, never a default dressed up as data (the class estimate of a speed
limit is made, and flagged, by the scorer with the app's own estimate).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import osmium

# ---- what is drivable ---------------------------------------------------------------------------------------------
ROAD_CLASS = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "unclassified": 5, "road": 5,
              "residential": 6, "living_street": 6, "service": 7, "track": 7}
LINKS = {"motorway_link": "motorway", "trunk_link": "trunk", "primary_link": "primary", "secondary_link": "secondary",
         "tertiary_link": "tertiary"}
SERVICE_EXCLUDED = {"parking_aisle", "driveway", "drive-through", "drive_through", "emergency_access"}
NO_ACCESS = {"no", "private", "agricultural", "forestry", "discouraged_not", "military", "use_sidepath"}
RESTRICTED = {"destination", "customers", "delivery"}
YES_ACCESS = {"yes", "designated", "permissive", "official"}
# every vehicle way (routable or not) counts as a join where it meets a road: side roads, driveways, car-park entrances
VEHICLE_HW = set(ROAD_CLASS) | set(LINKS)
# the router's use codes (web/route_ctx/router_edges.js ROAD_USE)
USE_ROAD, USE_RAMP, USE_TRACK, USE_DRIVEWAY, USE_ALLEY, USE_PARKING, USE_LIVING, USE_SERVICE = 0, 1, 3, 4, 5, 6, 10, 11
# router surface codes: 0 paved smooth, 1 paved, 2 paved rough, 3 compacted, 4 dirt, 5 gravel, 6 path, 7 impassable
SURFACE = {"asphalt": 0, "concrete": 0, "concrete:plates": 1, "paved": 1, "paving_stones": 1, "chipseal": 1, "metal": 1,
           "wood": 2, "concrete:lanes": 2, "sett": 2, "cobblestone": 2, "unhewn_cobblestone": 2, "brick": 2, "bricks": 2,
           "compacted": 3, "fine_gravel": 3, "dirt": 4, "earth": 4, "ground": 4, "mud": 4, "gravel": 5, "pebblestone": 5,
           "unpaved": 5, "rock": 5, "grass": 6, "sand": 6, "grass_paver": 3}

# ---- businesses (shops, services, food, offices, lodging), NOT fuel or cafes (the owner; web/route_ctx/osm_tiles.js) ----
BUSINESS_AMENITY = {"restaurant", "fast_food", "bar", "pub", "biergarten", "ice_cream", "bank", "pharmacy", "dentist",
                    "doctors", "clinic", "veterinary", "cinema", "theatre", "nightclub", "casino", "car_wash", "car_rental",
                    "food_court", "marketplace", "money_transfer", "bureau_de_change", "nightclub", "stripclub", "vehicle_inspection"}
NOT_BUSINESS_SHOP = {"coffee", "tea", "vacant", "no", "yes;vacant"}
BUSINESS_TOURISM = {"hotel", "motel", "guest_house", "hostel"}

# ---- land use (as osm_tiles.js maps OpenMapTiles classes) ----------------------------------------------------------
def landuse_class(t: dict) -> str | None:
    lu, nat, lei, bnd = t.get("landuse"), t.get("natural"), t.get("leisure"), t.get("boundary")
    if lei in ("park", "nature_reserve", "garden") or bnd in ("protected_area", "national_park") or lu == "recreation_ground":
        return "park"
    if lu == "residential":
        return "residential"
    if lu == "commercial":
        return "commercial"
    if lu == "retail":
        return "retail"
    if lu in ("industrial", "railway", "quarry", "landfill", "construction", "brownfield"):
        return "industrial"
    if lu == "forest" or nat == "wood":
        return "forest"
    if lu in ("farmland", "farmyard", "orchard", "vineyard", "plant_nursery", "greenhouse_horticulture", "allotments"):
        return "farmland"
    if lu in ("meadow", "grass", "village_green", "cemetery") or nat in ("grassland", "scrub", "heath", "wetland", "fell"):
        return "open"
    return None


def is_water_area(t: dict) -> bool:
    return t.get("natural") == "water" or t.get("landuse") in ("reservoir", "basin") or t.get("waterway") == "riverbank"


def is_business(t: dict) -> bool:
    if t.get("amenity") in ("fuel", "cafe"):
        return False
    shop = t.get("shop")
    if shop and shop not in NOT_BUSINESS_SHOP:
        return True
    return (t.get("amenity") in BUSINESS_AMENITY or bool(t.get("office")) and t.get("office") != "no"
            or t.get("tourism") in BUSINESS_TOURISM or bool(t.get("craft")) or t.get("healthcare") in ("doctor", "dentist", "clinic", "pharmacy"))


def parse_speed(v: str | None) -> float | None:
    """OSM maxspeed -> km/h; None for 'signals', 'none', zones and anything unreadable (unknown stays unknown)."""
    if not v:
        return None
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(mph|km/h|kmh|kph)?\s*$", v.split(";")[0])
    if not m:
        return None
    x = float(m.group(1))
    return round(x * 1.609344, 1) if m.group(2) == "mph" else x


def access_of(t: dict) -> str:
    """'yes' | 'restricted' | 'no' for a car, from motorcar > motor_vehicle > vehicle > access."""
    for k in ("motorcar", "motor_vehicle", "vehicle", "access"):
        v = t.get(k)
        if v is None:
            continue
        v = v.split(";")[0]
        if v in NO_ACCESS:
            return "no"
        if v in RESTRICTED:
            return "restricted"
        if v in YES_ACCESS:
            return "yes"
    return "yes"


def drivable(t: dict) -> dict | None:
    """The routing attributes of a way, or None when a car can't use it."""
    hw = t.get("highway")
    ferry = t.get("route") == "ferry"
    if ferry:
        mv = t.get("motorcar") or t.get("motor_vehicle")
        if mv not in ("yes", "designated"):
            return None
    elif hw not in ROAD_CLASS and hw not in LINKS:
        return None
    if t.get("area") == "yes":
        return None
    if hw == "service" and t.get("service") in SERVICE_EXCLUDED:
        return None
    if hw == "track" and not ((t.get("motor_vehicle") or t.get("motorcar")) in ("yes", "designated", "permissive")):
        return None
    acc = access_of(t)
    if acc == "no":
        return None
    base = LINKS.get(hw, hw)
    rc = 5 if ferry else ROAD_CLASS[base]
    use = USE_RAMP if hw in LINKS else USE_TRACK if hw == "track" else USE_LIVING if hw == "living_street" else (
        USE_ALLEY if hw == "service" and t.get("service") == "alley" else USE_SERVICE if hw == "service" else USE_ROAD)
    ow = t.get("oneway")
    junction = t.get("junction")
    if ow in ("yes", "true", "1"):
        oneway = 1
    elif ow == "-1" or ow == "reverse":
        oneway = -1
    elif ow in ("no", "false", "0", "alternating", "reversible"):
        oneway = 0
    else:
        oneway = 1 if junction in ("roundabout", "circular") or hw in ("motorway", "motorway_link") else 0
    lanes = None
    try:
        if t.get("lanes"):
            n = int(float(t["lanes"].split(";")[0]))
            lanes = n if oneway else max(1, n // 2)
        if not oneway and t.get("lanes:forward"):
            lanes = int(float(t["lanes:forward"].split(";")[0]))
    except ValueError:
        lanes = None
    sw = t.get("sidewalk") or t.get("sidewalk:both")
    if sw is None and (t.get("sidewalk:left") or t.get("sidewalk:right")):
        sw = "yes" if "yes" in (t.get("sidewalk:left"), t.get("sidewalk:right"), "separate") else "no"
    sidewalk = None if sw is None else (0 if sw in ("no", "none") else 1)
    surf = t.get("surface")
    return {
        "hw": "ferry" if ferry else hw, "rc": rc, "use": use, "cls": 9 if ferry else 8 if hw == "track" else rc,
        "oneway": oneway, "maxspeed": parse_speed(t.get("maxspeed")), "lanes": lanes,
        "surface": SURFACE.get(surf.split(";")[0]) if surf else None, "sidewalk": sidewalk,
        "bridge": 1 if t.get("bridge") not in (None, "no") else 0, "tunnel": 1 if t.get("tunnel") not in (None, "no") else 0,
        "toll": 1 if t.get("toll") == "yes" else 0, "roundabout": 1 if junction in ("roundabout", "circular") else 0,
        "ramp": 1 if hw in LINKS else 0, "truck": 1 if t.get("hgv") == "designated" else None,
        "destination": 1 if acc == "restricted" else 0, "ferry": 1 if ferry else 0,
        "name": t.get("name") or t.get("ref") or None, "ref": t.get("ref") or None,
        "lit": None if t.get("lit") is None else (1 if t.get("lit") == "yes" else 0),
        "duration": t.get("duration") if ferry else None,
    }


# attributes that must match for two ways to merge into one edge at a degree-2 joint
MERGE_KEYS = ("hw", "rc", "use", "oneway", "maxspeed", "lanes", "surface", "sidewalk", "bridge", "tunnel", "toll",
              "roundabout", "destination", "ferry", "name", "truck")

# ---- node features ------------------------------------------------------------------------------------------------
def node_kind(t: dict) -> set[str]:
    out = set()
    hw = t.get("highway")
    if hw == "traffic_signals" or t.get("crossing") == "traffic_signals" and hw != "crossing":
        out.add("signal")
    if hw == "stop":
        out.add("stop")
    if hw == "give_way":
        out.add("give_way")
    if hw == "crossing" or (t.get("crossing") and t.get("crossing") != "no" and hw != "traffic_signals"):
        out.add("crossing")
    if t.get("traffic_calming") and t.get("traffic_calming") != "no" or hw == "speed_bump":
        out.add("calming")
    if t.get("railway") in ("level_crossing", "crossing") and t.get("railway") == "level_crossing":
        out.add("level_crossing")
    b = t.get("barrier")
    if b in ("gate", "lift_gate", "swing_gate", "sliding_gate", "toll_booth", "chain", "kissing_gate", "cattle_grid"):
        if access_of(t) == "no" or b in ("chain", "kissing_gate"):
            out.add("block")
        elif b != "cattle_grid" and b != "toll_booth":
            out.add("gate")
    if b in ("bollard", "block", "jersey_barrier", "planter", "rising_bollard"):
        mv = t.get("motor_vehicle") or t.get("motorcar") or t.get("access")
        if mv not in ("yes", "designated", "permissive", "destination"):
            out.add("block")
    return out


@dataclass
class Raw:
    ways: dict = field(default_factory=dict)        # way id -> (attrs, [node ids])
    coords: dict = field(default_factory=dict)      # node id -> (lat, lon) for nodes on drivable ways
    vdeg: dict = field(default_factory=dict)        # node id -> arms of any vehicle way (joins)
    feats: dict = field(default_factory=dict)       # node id -> set of kinds (on any way)
    pois: list = field(default_factory=list)        # (lat, lon) businesses
    buildings: list = field(default_factory=list)   # (lat, lon) building centres
    landuse: list = field(default_factory=list)     # (class, [[(lat, lon), ...] outer], [[inner]...])
    water_areas: list = field(default_factory=list)  # [[(lat, lon)...]] outer rings
    waterways: list = field(default_factory=list)   # [(lat, lon), ...] river / stream / canal centre lines (open)
    sidewalks: list = field(default_factory=list)   # [(lat, lon), ...] footway=sidewalk lines
    road_segs: list = field(default_factory=list)   # (mid lat, mid lon, metres) of every vehicle way, routable or not
    addresses: list = field(default_factory=list)   # (lat, lon) address points (addr:housenumber nodes and buildings)
    schools: list = field(default_factory=list)     # (lat, lon) amenity=school / kindergarten / college
    worship: list = field(default_factory=list)     # (lat, lon) amenity=place_of_worship
    restrictions: list = field(default_factory=list)  # (from way, via node, to way, only)
    via_way_restrictions: int = 0
    via_restrictions: list = field(default_factory=list)   # (from way, [via ways], to way, only)
    timestamp: str | None = None


WATERWAY_LINES = {"river", "stream", "canal"}
SCHOOLS = {"school", "kindergarten", "college"}


def read(path: str, bbox=None) -> Raw:
    """One pass over the extract (pyosmium with node locations and areas). bbox (w, s, e, n) keeps only ways with a
    node inside it (the CI extract is clipped already; this is for the fixtures)."""
    raw = Raw()
    fp = osmium.FileProcessor(path).with_locations().with_areas()
    raw.timestamp = fp.header.get("osmosis_replication_timestamp") or None
    w, s, e, n = bbox if bbox else (-180, -90, 180, 90)
    inside = lambda la, lo: s <= la <= n and w <= lo <= e  # noqa: E731
    vdeg = raw.vdeg
    for o in fp:
        if o.is_node():
            if not o.tags:
                continue
            t = dict(o.tags)
            k = node_kind(t)
            if k:
                raw.feats[o.id] = k
            if not o.location.valid():
                continue
            la, lo = o.location.lat, o.location.lon
            if t.get("addr:housenumber"):
                raw.addresses.append((la, lo))
            if t.get("amenity") in SCHOOLS:
                raw.schools.append((la, lo))
            elif t.get("amenity") == "place_of_worship":
                raw.worship.append((la, lo))
            if is_business(t):
                raw.pois.append((la, lo))
            elif t.get("building") and o.id < 0:          # osm_api.py's building centres
                raw.buildings.append((la, lo))
        elif o.is_way():
            t = dict(o.tags)
            hw = t.get("highway")
            if hw in VEHICLE_HW:
                refs = [nd.ref for nd in o.nodes]
                for k_, r in enumerate(refs):
                    vdeg[r] = vdeg.get(r, 0) + (1 if k_ in (0, len(refs) - 1) else 2)
                try:
                    pts = [(nd.lat, nd.lon) for nd in o.nodes]
                    for a_, b_ in zip(pts, pts[1:]):
                        raw.road_segs.append(((a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2, hav(a_, b_)))
                except osmium.InvalidLocationError:
                    pass
            if hw == "footway" and t.get("footway") == "sidewalk":
                try:
                    raw.sidewalks.append([(nd.lat, nd.lon) for nd in o.nodes])
                except osmium.InvalidLocationError:
                    pass
            ww = t.get("waterway")
            if ww in WATERWAY_LINES and t.get("tunnel") not in ("culvert", "yes"):
                try:
                    raw.waterways.append([(nd.lat, nd.lon) for nd in o.nodes])
                except osmium.InvalidLocationError:
                    pass
            a = drivable(t)
            if not a:
                continue
            try:
                pts = [(nd.ref, nd.lat, nd.lon) for nd in o.nodes]
            except osmium.InvalidLocationError:
                pts = [(nd.ref, nd.lat, nd.lon) for nd in o.nodes if nd.location.valid()]
            if len(pts) < 2:
                continue
            if bbox and not any(inside(la, lo) for _, la, lo in pts):
                continue
            refs = [p[0] for p in pts]
            if a["oneway"] == -1:
                refs.reverse()
                a["oneway"] = 1
            for r, la, lo in pts:
                raw.coords[r] = (la, lo)
            raw.ways[o.id] = (a, refs)
        elif o.is_relation():
            t = dict(o.tags)
            typ = t.get("type")
            if typ != "restriction":
                continue
            r = t.get("restriction:motorcar") or t.get("restriction")
            if not r or "motorcar" in (t.get("except") or "").split(";"):
                continue
            if t.get("restriction:conditional") and not t.get("restriction"):
                continue
            frm = [m.ref for m in o.members if m.type == "w" and m.role == "from"]
            to = [m.ref for m in o.members if m.type == "w" and m.role == "to"]
            via_n = [m.ref for m in o.members if m.type == "n" and m.role == "via"]
            via_w = [m.ref for m in o.members if m.type == "w" and m.role == "via"]
            if via_w:
                raw.via_way_restrictions += 1
                if len(frm) == 1 and len(to) == 1 and not via_n and (r.startswith("no_") or r.startswith("only_")):
                    raw.via_restrictions.append((frm[0], via_w, to[0], r.startswith("only_")))
                continue
            if len(frm) == 1 and len(to) == 1 and len(via_n) == 1 and (r.startswith("no_") or r.startswith("only_")):
                raw.restrictions.append((frm[0], via_n[0], to[0], r.startswith("only_")))
        elif o.is_area():
            t = dict(o.tags)
            cls = landuse_class(t)
            water = is_water_area(t)
            bldg = t.get("building") not in (None, "no")
            biz = is_business(t)
            school, church, addr = t.get("amenity") in SCHOOLS, t.get("amenity") == "place_of_worship", bool(t.get("addr:housenumber"))
            if not (cls or water or bldg or biz or school or church or addr):
                continue
            try:
                rings = [([(p.lat, p.lon) for p in ring], [[(p.lat, p.lon) for p in inner] for inner in o.inner_rings(ring)])
                         for ring in o.outer_rings()]
            except osmium.InvalidLocationError:
                continue
            outers = [r for r, _ in rings]
            ring = outers[0] if outers else None
            if bldg or biz:
                if ring:
                    c = (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
                    if bldg:
                        raw.buildings.append(c)
                    if biz:
                        raw.pois.append(c)
                if ring and (school or church or addr):
                    c = (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
                    if school:
                        raw.schools.append(c)
                    if church:
                        raw.worship.append(c)
                    if addr:
                        raw.addresses.append(c)
            if cls:
                for ring, inners in rings:
                    raw.landuse.append((cls, ring, inners))
            if water:
                raw.water_areas.extend(outers)
    return raw


# ---- the graph ----------------------------------------------------------------------------------------------------
@dataclass
class Chain:
    nodes: list            # OSM node ids, first and last are graph nodes
    attrs: dict
    way_first: int
    way_last: int
    ways: list             # every way id along it


def hav(a, b):
    la1, lo1 = a
    la2, lo2 = b
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = p2 - p1, math.radians(lo2 - lo1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(min(1, math.sqrt(h)))


def bearing(a, b):
    la1, lo1 = map(math.radians, a)
    la2, lo2 = map(math.radians, b)
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return math.atan2(y, x) % (2 * math.pi)


def build_chains(raw: Raw) -> tuple[list[Chain], set]:
    """Drivable ways -> chains between graph nodes (junctions, dead ends, attribute changes, barriers, restriction via
    nodes), degree-2 joints between compatible ways merged. Returns (chains, graph node ids)."""
    arms: dict[int, int] = {}
    ends: dict[int, list] = {}      # node -> [(way id, 'start'|'end')]
    for wid, (a, refs) in raw.ways.items():
        last = len(refs) - 1
        for k, r in enumerate(refs):
            arms[r] = arms.get(r, 0) + (1 if k in (0, last) else 2)
        ends.setdefault(refs[0], []).append((wid, "start"))
        ends.setdefault(refs[-1], []).append((wid, "end"))
    keep = set()
    via = {v for _, v, _, _ in raw.restrictions}
    for r, k in arms.items():
        f = raw.feats.get(r, ())
        if k != 2 or r in via or "block" in f or "gate" in f:
            keep.add(r)
    for r, lst in ends.items():
        if r in keep:
            continue
        if len(lst) == 1:          # a closed way's own start/end (a ring): merged through
            continue
        (wa, ea), (wb, eb) = lst
        A, B = raw.ways[wa][0], raw.ways[wb][0]
        same = all(A.get(k) == B.get(k) for k in MERGE_KEYS)
        if same and A["oneway"]:
            same = ea != eb            # one way ends where the other starts: same direction
        if not same:
            keep.add(r)
    # pieces: each way cut at kept nodes
    pieces = []
    at_end: dict[int, list] = {}
    for wid, (a, refs) in raw.ways.items():
        cur = [refs[0]]
        for r in refs[1:]:
            cur.append(r)
            if r in keep:
                pieces.append((wid, cur))
                cur = [r]
        if len(cur) > 1:
            pieces.append((wid, cur))
    for k, (wid, nodes) in enumerate(pieces):
        at_end.setdefault(nodes[0], []).append(k)
        at_end.setdefault(nodes[-1], []).append(k)
    used = [False] * len(pieces)
    chains = []

    def walk(k, forward):
        wid, nodes = pieces[k]
        seq = list(nodes) if forward else list(reversed(nodes))
        ways = [wid]
        used[k] = True
        guard = 0
        while seq[-1] not in keep and guard < 100000:
            guard += 1
            nxt = [q for q in at_end.get(seq[-1], []) if not used[q]]
            if not nxt:
                break
            q = nxt[0]
            w2, n2 = pieces[q]
            used[q] = True
            s2 = n2 if n2[0] == seq[-1] else list(reversed(n2))
            seq.extend(s2[1:])
            ways.append(w2)
        return seq, ways

    for k, (wid, nodes) in enumerate(pieces):
        if used[k]:
            continue
        a_first, a_last = nodes[0] in keep, nodes[-1] in keep
        if not a_first and not a_last:
            continue                    # picked up from a kept end, or an isolated ring (no way in or out)
        if a_first:
            seq, ways = walk(k, True)
        else:
            seq, ways = walk(k, False)
            # walked backwards from the kept end: put it the way's own way round so one-ways stay right
            seq.reverse()
            ways.reverse()
        if seq[0] not in keep or seq[-1] not in keep:
            # a chain that ran into a dead loop: make its far end a node
            keep.add(seq[0])
            keep.add(seq[-1])
        attrs = raw.ways[ways[0]][0]
        if len(seq) >= 2 and not (len(seq) == 2 and seq[0] == seq[1]):
            chains.append(Chain(seq, attrs, ways[0], ways[-1], ways))
    # oneway chains walked backwards: walk() follows the pieces' orientation when they agree (merge rule), so a oneway
    # chain is oriented along its first way. Cut at blocking barriers: the chain stops being drivable through them.
    out = []
    for c in chains:
        # a blocking barrier (bollard, locked gate) is a graph node nothing passes through: each chain ending there gets a
        # node of its own at the same place, so the barrier is a dead end from both sides
        for end in (0, -1):
            r = c.nodes[end]
            if "block" in raw.feats.get(r, ()):
                syn = -(len(raw.coords) + 10_000_000_000 + len(out) * 2 + (1 if end else 0))
                raw.coords[syn] = raw.coords[r]
                raw.feats[syn] = {"block"}
                c.nodes[end] = syn
        if c.attrs["oneway"]:
            fw = raw.ways[c.way_first][1]
            # orientation check: the chain's first two nodes in the first way's order
            try:
                i0, i1 = fw.index(c.nodes[0]), fw.index(c.nodes[1])
                if i1 < i0 and not (fw[0] == fw[-1]):
                    c.nodes.reverse()
                    c.ways.reverse()
                    c.way_first, c.way_last = c.ways[0], c.ways[-1]
            except ValueError:
                pass
        out.append(c)
    nodes = set()
    for c in out:
        nodes.add(c.nodes[0])
        nodes.add(c.nodes[-1])
    return out, nodes
