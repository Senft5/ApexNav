"""Checks on built graph tiles: counts and bytes per tile, and the spot-check roads (docs/OWN_ROUTING.md §8).

    python -m tools.graph_etl.check web/data/graph/v1 [--roads]

Per named road: length, length-weighted quality and scenery (0..1, unknown left out), gated corner points per km, the
class and speed most of it has, and travel speed. Exit status 1 when a spot check fails (Colerain Avenue low quality,
the back roads high, I-275 a motorway at speed), so CI can gate on it.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict

from . import tiles as T

SPOT = [
    # (label, name regex, box (s, w, n, e) or None, test on the summary, what it should be). Blue Rock Road: the stretch
    # the calibration's Blue Rock route drives (north of the I-275 ring; inside it the road is a 35 mph suburban street)
    ("Colerain Avenue", r"^Colerain Avenue$", None, lambda r: r["quality"] < 0.40, "low quality (< 0.40)"),
    # Springdale Road: the suburban stretch east of Blue Rock (the subdivision and Northgate cases); west of it, toward
    # New Haven, it is a country road and scores 0.55
    ("Springdale Road (east of -84.62)", r"^Springdale Road$", (39.2, -84.62, 39.35, -84.5), lambda r: r["quality"] < 0.40, "low quality (< 0.40): suburban"),
    ("Hamilton Avenue", r"^Hamilton Avenue$", None, lambda r: r["quality"] < 0.40, "low quality (< 0.40): suburban"),
    # Pippin Road is suburban too (houses along it, 670 homes/km²): the live engine rates it 0.33 on the router's own
    # data; it wins the subdivision case only against worse streets. Reported, not gated.
    ("Pippin Road", r"^Pippin Road$", None, lambda r: True, "reported (the live engine: 0.33)"),
    ("Blue Rock Road (north of I-275)", r"^Blue Rock Road$", (39.233, -84.75, 39.40, -84.55), lambda r: r["quality"] >= 0.55, "high quality (>= 0.55)"),
    ("East Miami River Road", r"^(East |E )?Miami River Road$", None, lambda r: r["quality"] >= 0.55, "high quality (>= 0.55)"),
    ("Lees Creek Road", r"^Lees Creek Road$", None, lambda r: r["quality"] >= 0.55, "high quality (>= 0.55)"),
    ("I-275 (Circle Freeway)", r"^(Circle Freeway|I 275|I-275|Interstate 275)", None, lambda r: r["cls"] == 0 and r["kmh"] >= 85,
     "motorway at speed (class 0, >= 85 km/h)"),
]


def load(d):
    ix = json.load(open(os.path.join(d, "index.json")))
    return ix, dict(each(d, ix))


def each(d, ix):
    """The tiles one at a time, (name, (bytes, tile)): the lower 48 decoded at once (62 million edges, 2026-11-14) ran
    the publish runner out of memory."""
    for name in sorted(ix["tiles"]):
        b = open(os.path.join(d, f"{name}.vgr"), "rb").read()
        yield name, (len(b), T.read_tile(b))


class Road:
    """One spot-check road's sums, added to tile by tile."""

    def __init__(self, pattern, box=None):
        self.rx, self.box = re.compile(pattern), box
        self.L = self.q = self.qL = self.s = self.sL = self.f = self.t = 0.0
        self.cls, self.spd = Counter(), Counter()

    def add(self, r):
        e, names = r["edges"], r["names"]
        for k in range(len(e["to"])):
            nm = names[e["name"][k]] if e["name"][k] != T.NO_NAME else ""
            if not self.rx.search(nm):
                continue
            if self.box:
                g = r["geom"](k)
                la, lo = g[len(g) // 2]
                if not (self.box[0] <= la / 1e6 <= self.box[2] and self.box[1] <= lo / 1e6 <= self.box[3]):
                    continue
            ln = e["len_dm"][k] / 10
            self.L += ln
            if e["quality"][k] != T.UNKNOWN_U8:
                self.q += e["quality"][k] / 254 * ln
                self.qL += ln
            if e["scenery"][k] != T.UNKNOWN_U8:
                self.s += e["scenery"][k] / 254 * ln
                self.sL += ln
            if e["fun"][k] != T.UNKNOWN_FUN:
                self.f += e["fun"][k] / 100
            self.t += e["t_ds"][k] / 10
            self.cls[e["cls"][k]] += ln
            self.spd[e["speed"][k]] += ln

    def summary(self):
        L = self.L
        if not L:
            return None
        return {"km": round(L / 1000, 2), "quality": round(self.q / self.qL, 3) if self.qL else None,
                "scenery": round(self.s / self.sL, 3) if self.sL else None, "fun_per_km": round(self.f / (L / 1000), 2),
                "cls": self.cls.most_common(1)[0][0], "speed": self.spd.most_common(1)[0][0],
                "kmh": round(L / self.t * 3.6, 1) if self.t else None}


def summarise(tiles, pattern, box=None):
    road = Road(pattern, box)
    for _, r in tiles.values():
        road.add(r)
    return road.summary()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--json", default=None, help="write the report here too")
    a = ap.parse_args(argv)
    ix = json.load(open(os.path.join(a.dir, "index.json")))
    rep = {"tiles": {}, "spot": {}}
    roads = [Road(rx, box) for _, rx, box, _, _ in SPOT]
    tot_b = tot_e = tot_n = n = 0
    for name, (nb, r) in each(a.dir, ix):
        n += 1
        for road in roads:
            road.add(r)
        ne, nn = len(r["edges"]["to"]), len(r["nodes"]["lat"])
        rep["tiles"][name] = {"bytes": nb, "edges": ne, "nodes": nn, "restrictions": len(r["restrictions"]),
                              "unknown_quality": sum(1 for x in r["edges"]["quality"] if x == T.UNKNOWN_U8)}
        tot_b, tot_e, tot_n = tot_b + nb, tot_e + ne, tot_n + nn
        print(f"{name}: {nb / 1e6:6.2f} MB  {ne:7d} edges  {nn:7d} nodes  {len(r['restrictions'])} restrictions")
    print(f"total: {tot_b / 1e6:.2f} MB, {tot_e} edges, {tot_n} nodes, {n} tiles; model {ix.get('model', '')[:12]}")
    rep["total"] = {"bytes": tot_b, "edges": tot_e, "nodes": tot_n}
    ok = True
    print("\nroad | km | quality | scenery | fun/km | class | limit | km/h | check")
    for (label, _, _, test, want), road in zip(SPOT, roads):
        r = road.summary()
        if r is None:
            print(f"{label} | not in these tiles")
            rep["spot"][label] = None
            continue
        good = r["quality"] is not None and test(r)
        ok &= good
        rep["spot"][label] = {**r, "ok": good, "want": want}
        print(f"{label} | {r['km']} | {r['quality']} | {r['scenery']} | {r['fun_per_km']} | {r['cls']} | {r['speed']} | {r['kmh']} | "
              f"{'ok' if good else 'FAIL'}: {want}")
    if a.json:
        json.dump(rep, open(a.json, "w"), indent=1)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
