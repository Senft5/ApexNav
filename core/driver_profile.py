"""Driver profile ("Your driving"): what a person's own drives, taken together, say about how they drive.

Every clean, fully measured corner of every drive becomes one observation (`observe`): six technique credits (0..1),
three style facts and the context it was driven in (which way it turned, how tight, uphill or down, how far into the
drive). `profile` then answers, over all of them:

  * a level per skill (0..100), unknown under SKILL_MIN corners;
  * where the driver is measurably better or worse (lefts against rights, tight against fast, downhill against uphill,
    the first ten minutes, after an hour, one car against the others, a tag against the rest), each kept only when the
    difference is large, well beyond its standard error, and repeats drive after drive;
  * the same levels for each kind of corner (direction x size);
  * each skill month by month, and whether the newest month differs from the first;
  * the strongest skill and, when one is clearly short (FOCUS_MAX), the one to work on and the place it shows most.

Technique only: no speed, time or legality enters a level, and nothing here rewards pace. The share of a corner's sane
limit used is reported as a style fact, never as a skill. Unknown stays unknown (None). `web/driver_profile.js` is the
port, held to parity by tests/test_driver_profile.py.
"""
from __future__ import annotations

import math

import numpy as np

from core import drive_analysis as da

SKILLS = ("squeeze", "brake", "arc", "entry", "line", "exit")
# In the order a corner is driven:
#  squeeze  braking in one go: on once, off once, no second stab or early lift
#  brake    brakes done by the apex: nothing hard after it
#  arc      steering in one arc: the load the steering asks for builds once and eases once, no sawing at the wheel
#  entry    entry speed judged right: the car slows once and speeds up once, no lift or second slowing mid-corner
#  line     patient to the apex: the car is slowest at the corner's middle or after, not long before it
#  exit     straight back to power: no coasting between the brakes and the throttle
# squeeze, arc and entry are measured against what the corner itself needs (one rise and one fall), so a tight road
# does not read as rough hands; comparisons other than by size are made on what is left after each corner's size.

SWING_G = 0.10               # a reversal of load smaller than this is sensor noise, not an input (noise is 0.02-0.04 g a bin)
ARC_SPAN_G = 0.6             # extra lateral swing in one corner that leaves no credit (three 0.1 g corrections)
SQUEEZE_SPAN_G = 0.5         # extra braking swing that leaves no credit
SQUEEZE_MIN_G = 0.20         # a braking run lighter than this at its peak is not judged
SQUEEZE_PAD = 2              # bins either side of the braking its swing is read over
SQUEEZE_GAP = 6              # braking that ended up to this many bins (30 m) before the run belongs to the same approach
ENTRY_SWING_MPS = 0.6        # a reversal of speed smaller than this is GPS noise (about 0.15 m/s a bin)
SLOW_PAD = 10                # bins either side of the corner the slowest point is looked for (it may come before the corner)
ENTRY_SPAN_MPS = 3.0         # extra speed swing through one corner that leaves no credit
FOCUS_MAX = 85               # a weakest skill above this is not something to work on
EXIT_FREE_M = 10.0           # coasting between the brakes and the throttle that costs nothing (two bins)...
EXIT_SPAN_M = 40.0           # ...and the further coasting that takes the credit to zero
LINE_FREE_M = 5.0            # slowest point this far before the apex is still on it (one bin)...
LINE_SPAN_M = 25.0           # ...and 30 m early is no credit: the car was slowest long before the corner's middle
TRAIL_MIN_M = 10.0           # two bins of braking with the car loaded sideways: trail braking, not noise
GRADE_PAD = 10               # bins either side of the corner the slope is read over (GPS height is too noisy over 50 m)
GRADE_MIN = 0.04             # 4 %: clearly uphill or downhill
WARM_MIN = 10.0              # minutes of moving time that count as the start of a drive
LONG_MIN = 60.0              # ...and after this, a long drive

SKILL_MIN = 30               # corners before a skill has a level
STYLE_MIN = 20
MATRIX_MIN = 10              # corners of one kind before that kind has a level
SPLIT_MIN = 12               # corners on each side of a comparison
SPLIT_FLOOR = 0.08           # a difference smaller than this is not worth saying
SPLIT_SE = 3.0               # ...and it must be this many standard errors (many comparisons are tried)
SPLIT_DRIVE_MIN = 3          # corners of each side one drive needs to vote on a comparison
SPLIT_DRIVES = 2             # drives that must hold both sides
GROUP_DRIVES = 4             # whole-drive comparisons (a car, a tag): drives on each side
GROUP_DRIVE_MIN = 5          # ...each with this many corners
TREND_MIN = 15               # corners in a month before the month has a level
TREND_FLOOR = 0.05
TREND_SE = 2.0
TOP_FINDINGS = 8


def _size(sev):
    if not isinstance(sev, (int, float)) or not math.isfinite(sev):
        return None
    return "tight" if sev <= 2 else ("medium" if sev <= 4 else "fast")


def _clamp01(x: float) -> float:
    return min(1.0, max(0.0, x))


def _swing(x: list, h: float = SWING_G) -> float:
    """Total movement of x between its turning points, a turn counting only once x has come back by h or more."""
    tv, ref, ext, way = 0.0, x[0], x[0], 0
    for val in x[1:]:
        if way == 0:
            if abs(val - ref) >= h:
                way, ext = (1 if val > ref else -1), val
        elif way == 1:
            if val > ext:
                ext = val
            elif ext - val >= h:
                tv, ref, way, ext = tv + (ext - ref), ext, -1, val
        else:
            if val < ext:
                ext = val
            elif val - ext >= h:
                tv, ref, way, ext = tv + (ref - ext), ext, 1, val
    return tv + abs(ext - ref) if way != 0 else tv


def _excess(x: list, h: float = SWING_G) -> float:
    """Movement beyond the one rise to the peak and one fall from it that x needs (x: load towards its peak, positive)."""
    top = max(x)
    return max(0.0, _swing(x, h) - ((top - x[0]) + (top - x[-1])))


def _brake_run(lon, start: int, apex: int):
    """(first, last) bin of the braking run nearest the apex, as corner_phases finds it, or None."""
    lo = max(0, apex - da.BRAKE_LOOKBACK)
    r1 = apex
    while r1 >= lo and not lon[r1] < da.BRAKE_G:
        r1 -= 1
    if r1 < lo or r1 < start - da.BRAKE_GAP:
        return None
    r0 = r1
    while r0 - 1 >= lo and lon[r0 - 1] < da.BRAKE_G:
        r0 -= 1
    return r0, r1


def observe(drive: dict) -> list:
    """One observation per corner the coach may read (measured speed and g from the brake lookback to the throttle
    lookahead, no stop through it). drive: {speed_mps, lon_g, lat_g, g_known?, elev?, corners: [{start, end, apex,
    apex_mps, dir?, severity?, mods?}]}. A credit that cannot be told for a corner is None there."""
    v = np.asarray([math.nan if x is None else x for x in drive["speed_mps"]], dtype=float)
    lon = np.asarray(drive["lon_g"], dtype=float)
    lat = np.asarray(drive["lat_g"], dtype=float)
    n = len(v)
    t = [0.0] * n
    for i in range(1, n):
        t[i] = t[i - 1] + (5.0 / v[i - 1] if math.isfinite(v[i - 1]) and v[i - 1] >= da.STOPPED_MPS else 0.0)
    elev = drive.get("elev")
    d = {**drive, "speed_mps": v, "lon_g": lon, "lat_g": lat}
    out = []
    for c in drive["corners"]:
        s, e, a = c["start"], c["end"], c["apex"]
        if not da._known(d, s, e, a):
            continue
        tech = da.corner_technique(v, lon, lat, c)
        if tech is None:
            continue
        ph = da.corner_phases(v, lon, lat, s, e, a, c["apex_mps"])
        w0, w1 = max(0, s - SLOW_PAD), min(n - 1, e + SLOW_PAD)
        slow = da._marks(d, w0, w1, a)[1] if all(math.isfinite(v[q]) for q in range(w0, w1 + 1)) else None
        # the load the steering asks for, with the speed taken out (load ~ speed squared on one arc): slowing to the
        # middle of a long corner and driving out of it is one arc, not a correction
        vbar = da._mean_se([float(x) for x in v[s:e + 1]])[0]
        side = [float(lat[q]) * (vbar / max(float(v[q]), da.STOPPED_MPS)) ** 2 for q in range(s, e + 1)]
        peak = max(side, key=abs)
        arc = 1.0 - _clamp01(_excess([x if peak >= 0 else -x for x in side]) / ARC_SPAN_G)
        squeeze = None
        run = _brake_run(lon, s, a)
        if run is not None:
            lo, first = max(0, a - da.BRAKE_LOOKBACK), run[0]
            while True:                              # an earlier stab at the brakes on the same approach
                q = next((q for q in range(first - 1, max(lo, first - SQUEEZE_GAP) - 1, -1) if lon[q] < da.BRAKE_G), None)
                if q is None:
                    break
                first = q
            b0, b1 = max(0, first - SQUEEZE_PAD), min(n - 1, run[1] + SQUEEZE_PAD)
            if all(math.isfinite(lon[q]) for q in range(b0, b1 + 1)):
                dec = [-float(x) for x in lon[b0:b1 + 1]]
                if max(dec) >= SQUEEZE_MIN_G:
                    squeeze = 1.0 - _clamp01(_excess(dec) / SQUEEZE_SPAN_G)
        grade = None
        if elev is not None:
            g0, g1 = max(0, s - GRADE_PAD), min(n - 1, e + GRADE_PAD)
            h0, h1 = elev[g0], elev[g1]
            if g1 > g0 and h0 is not None and h1 is not None and math.isfinite(h0) and math.isfinite(h1):
                slope = (h1 - h0) / ((g1 - g0) * 5.0)
                grade = "up" if slope >= GRADE_MIN else ("down" if slope <= -GRADE_MIN else "flat")
        mods = c.get("mods")
        out.append({
            "apex": a,
            "dir": c.get("dir") if c.get("dir") in ("L", "R") else None,
            "size": _size(c.get("severity")),
            "tightens": None if mods is None else "tightens" in mods,
            "crest": None if mods is None else "over crest" in mods,
            "grade": grade,
            "minute": float(t[a] / 60.0),
            "use": float(tech["use"]),
            "arc": arc,
            "squeeze": squeeze,
            "brake": None if run is None else float(tech["brake"]),
            "exit": None if slow is None else 1.0 - _clamp01((ph["coast_m"] - EXIT_FREE_M) / EXIT_SPAN_M),
            "line": None if slow is None else 1.0 - _clamp01(((a - slow) * 5.0 - LINE_FREE_M) / LINE_SPAN_M),
            "entry": 1.0 - _clamp01(_excess([-float(x) for x in v[s:e + 1]], ENTRY_SWING_MPS) / ENTRY_SPAN_MPS),
            "trail": None if ph["brake_m"] is None else (1 if ph["trail_m"] >= TRAIL_MIN_M else 0),
            "slow_m": None if slow is None else (slow - a) * 5.0,
        })
    return out


def _level(m: float) -> int:
    return int(math.floor(100.0 * m + 0.5))


def _vals(obs: list, k: str) -> list:
    return [o[k] for o in obs if o[k] is not None]


def _welch(xa: list, xb: list):
    """(mean a, mean b, z) when a and b differ by SPLIT_FLOOR and SPLIT_SE standard errors, else None."""
    ma, sa = da._mean_se(xa)
    mb, sb = da._mean_se(xb)
    diff, se = ma - mb, math.sqrt(sa * sa + sb * sb)
    if abs(diff) < SPLIT_FLOOR or abs(diff) < SPLIT_SE * se:
        return None
    return ma, mb, (diff / se if se > 0 else None)


def _within(drives: list, skill: str, val, in_a, in_b):
    """A comparison inside drives (lefts against rights...): corners pooled, and each drive holding both sides votes.
    val(o): the corner's credit as compared (as measured for a comparison by size, else what is left after its size)."""
    xa, xb, votes = [], [], []
    for d in drives:
        a = [val(o) for o in d["obs"] if o[skill] is not None and in_a(o)]
        b = [val(o) for o in d["obs"] if o[skill] is not None and in_b(o)]
        xa.extend(a)
        xb.extend(b)
        if len(a) >= SPLIT_DRIVE_MIN and len(b) >= SPLIT_DRIVE_MIN:
            votes.append(da._mean_se(a)[0] - da._mean_se(b)[0])
    if len(xa) < SPLIT_MIN or len(xb) < SPLIT_MIN or len(votes) < SPLIT_DRIVES:
        return None
    w = _welch(xa, xb)
    if w is None:
        return None
    agree = sum(1 for x in votes if x != 0 and (x > 0) == (w[0] > w[1]))
    if agree * 3 < len(votes) * 2:               # two drives in three must show it the same way
        return None
    return {"mean_a": w[0], "mean_b": w[1], "n_a": len(xa), "n_b": len(xb), "drives": len(votes), "agree": agree, "z": w[2]}


def _between(drives: list, skill: str, val, is_a):
    """A comparison between whole drives (one car against the others, a tag against the rest): drive means compared."""
    ma, mb, na, nb = [], [], 0, 0
    for d in drives:
        xs = [val(o) for o in d["obs"] if o[skill] is not None]
        if len(xs) < GROUP_DRIVE_MIN:
            continue
        m = da._mean_se(xs)[0]
        if is_a(d):
            ma.append(m)
            na += len(xs)
        else:
            mb.append(m)
            nb += len(xs)
    if len(ma) < GROUP_DRIVES or len(mb) < GROUP_DRIVES:
        return None
    w = _welch(ma, mb)
    if w is None:
        return None
    return {"mean_a": w[0], "mean_b": w[1], "n_a": na, "n_b": nb, "drives": len(ma) + len(mb), "agree": None, "z": w[2]}


WITHIN = (
    ("dir", "L", "R", lambda o: o["dir"] == "L", lambda o: o["dir"] == "R"),
    ("size", "tight", "rest", lambda o: o["size"] == "tight", lambda o: o["size"] in ("medium", "fast")),
    ("size", "fast", "rest", lambda o: o["size"] == "fast", lambda o: o["size"] in ("tight", "medium")),
    ("shape", "tightens", "rest", lambda o: o["tightens"] is True, lambda o: o["tightens"] is False),
    ("crest", "crest", "rest", lambda o: o["crest"] is True, lambda o: o["crest"] is False),
    ("grade", "down", "up", lambda o: o["grade"] == "down", lambda o: o["grade"] == "up"),
    ("time", "start", "later", lambda o: o["minute"] < WARM_MIN, lambda o: o["minute"] >= WARM_MIN),
    ("time", "long", "before", lambda o: o["minute"] >= LONG_MIN, lambda o: o["minute"] < LONG_MIN),
)


def profile(drives: list) -> dict:
    """drives: [{id, month ('YYYY-MM' or None), car (label or None), tags ([str] or None), obs (observe's)}].

    Returns {corners, drives, skills, style, matrix, findings, trend, change, strongest, focus}; see the module text.
    A finding's mean_a and mean_b are levels (0..100) as compared: for comparisons other than by size, the driver's
    overall level plus what each side adds once every corner's size is taken out.
    """
    drives = [d for d in drives if d.get("obs")]
    every = [o for d in drives for o in d["obs"]]
    out = {"corners": len(every), "drives": len(drives), "skills": {}, "style": {}, "matrix": [], "findings": [],
           "trend": {}, "change": {}, "strongest": None, "focus": None}

    overall = {}
    for k in SKILLS:
        xs = _vals(every, k)
        overall[k] = da._mean_se(xs)[0] if xs else None
        if len(xs) >= SKILL_MIN:
            m, se = da._mean_se(xs)
            out["skills"][k] = {"level": _level(m), "n": len(xs), "se": da._r(100.0 * se, 2)}
        else:
            out["skills"][k] = {"level": None, "n": len(xs), "se": None}

    trail, slow, use = _vals(every, "trail"), _vals(every, "slow_m"), [o["use"] for o in every]
    out["style"] = {
        "trail_share": da._r(da._mean_se(trail)[0], 4) if len(trail) >= STYLE_MIN else None, "trail_n": len(trail),
        "slow_m": da._r(da._mean_se(slow)[0], 2) if len(slow) >= STYLE_MIN else None, "slow_n": len(slow),
        "use": da._r(da._median(use), 4) if len(use) >= SKILL_MIN else None,
    }

    by_size = {}                                   # each skill's mean for each size of corner (None: size unknown)
    for size in ("tight", "medium", "fast", None):
        cell = [o for o in every if o["size"] == size]
        for k in SKILLS:
            xs = _vals(cell, k)
            by_size[(k, size)] = da._mean_se(xs)[0] if xs else 0.0
    for way in ("L", "R"):
        for size in ("tight", "medium", "fast"):
            cell = [o for o in every if o["dir"] == way and o["size"] == size]
            levels = {}
            for k in SKILLS:
                xs = _vals(cell, k)
                levels[k] = _level(da._mean_se(xs)[0]) if len(xs) >= MATRIX_MIN else None
            out["matrix"].append({"dir": way, "size": size, "n": len(cell), "levels": levels})

    found = []

    def add(k, split, a, b, r, raw):
        if r is None:
            return
        base = 0.0 if raw else overall[k]
        found.append({"skill": k, "split": split, "a": a, "b": b, **r,
                      "mean_a": _level(_clamp01(base + r["mean_a"])), "mean_b": _level(_clamp01(base + r["mean_b"]))})

    for k in SKILLS:
        left = lambda o, k=k: o[k] - by_size[(k, o["size"])]
        for split, a, b, in_a, in_b in WITHIN:
            raw = split == "size"
            add(k, split, a, b, _within(drives, k, (lambda o, k=k: o[k]) if raw else left, in_a, in_b), raw)
        with_car = [d for d in drives if d.get("car")]
        cars = sorted({d["car"] for d in with_car})
        if len(cars) >= 2:
            for car in cars:
                add(k, "car", car, "rest", _between(with_car, k, left, lambda d, car=car: d["car"] == car), False)
        for tag in sorted({t for d in drives for t in (d.get("tags") or [])}):
            add(k, "tag", tag, "rest", _between(drives, k, left, lambda d, tag=tag: tag in (d.get("tags") or [])), False)
    # the strongest evidence first; one line per comparison (the skill it shows most in), the rest named beside it
    found.sort(key=lambda f: (-abs(f["z"]) if f["z"] is not None else -math.inf, f["split"], str(f["a"]), SKILLS.index(f["skill"])))
    seen = {}
    for f in found:
        key = (f["split"], f["a"])
        if key in seen:
            seen[key]["also"].append(f["skill"])
            continue
        f = {**f, "also": [], "z": None if f["z"] is None else da._r(f["z"], 2)}
        seen[key] = f
        out["findings"].append(f)
    out["findings"] = out["findings"][:TOP_FINDINGS]

    months = sorted({d["month"] for d in drives if d.get("month")})
    for k in SKILLS:
        rows, raw = [], []
        for mth in months:
            xs = [x for d in drives if d.get("month") == mth for x in _vals(d["obs"], k)]
            if len(xs) >= TREND_MIN:
                m, se = da._mean_se(xs)
                rows.append({"month": mth, "level": _level(m), "n": len(xs)})
                raw.append((m, se))
        out["trend"][k] = rows
        if len(rows) >= 2:
            (m0, s0), (m1, s1) = raw[0], raw[-1]
            diff, se = m1 - m0, math.sqrt(s0 * s0 + s1 * s1)
            out["change"][k] = {"from": rows[0]["month"], "to": rows[-1]["month"], "delta": rows[-1]["level"] - rows[0]["level"],
                                "sure": bool(abs(diff) >= TREND_FLOOR and abs(diff) >= TREND_SE * se)}

    known = [k for k in SKILLS if out["skills"][k]["level"] is not None]
    if len(known) >= 2:
        best = max(known, key=lambda k: (out["skills"][k]["level"], -SKILLS.index(k)))
        worst = min(known, key=lambda k: (out["skills"][k]["level"], SKILLS.index(k)))
        if out["skills"][best]["level"] > out["skills"][worst]["level"]:
            out["strongest"] = best
        if out["skills"][worst]["level"] <= FOCUS_MAX:
            f = next((f for f in out["findings"] if f["skill"] == worst), None)
            where = None if f is None else {"split": f["split"], "a": f["a"], "b": f["b"],
                                            "worse": f["a"] if f["mean_a"] < f["mean_b"] else f["b"]}
            out["focus"] = {"skill": worst, "where": where}
    return out
