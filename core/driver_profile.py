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

Touch (round two, from the ten g readings a second the recording keeps since #377): how fast the brakes go on and come
off, and how fast the car is loaded up at turn-in, in g a second, as style facts. Old drives, whose g was kept once a
second (a staircase or a straight ramp between fixes), give no touch: `_fine` tells them apart from the g itself.

The six skills are technique: no speed, time or legality enters them. Pace (IDEAS D-29, Nate 2026-11-10: "more speed
based stuff") is read beside them, the Vetta Score's own pace credit per corner (full from 85 % to 100 % of the corner's
sane limit, falling steeply above it, so overdriving never earns it): a level, by kind of corner, month by month, and where
it is measurably lower or higher (`pace_findings`), with the share of corners over the sane limit. It is never the
strongest, never a Work on and never practised: Vetta does not tell anyone to go faster. Unknown stays unknown (None). `web/driver_profile.js` is the
port, held to parity by tests/test_driver_profile.py.
"""
from __future__ import annotations

import math

import numpy as np

from core import drive_analysis as da

SKILLS = ("squeeze", "brake", "arc", "entry", "line", "exit")
PACE = "pace"
MEASURES = SKILLS + (PACE,)  # pace (IDEAS D-29) is read like a skill but is never the strongest, a Work on or a practice
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
DRIVE_TOUCH_MIN = 8          # corners one drive needs before its own touch is said (its Log page)
TOUCH_MIN_G = 0.25           # a braking or turn-in peaking lighter than this has no touch to read (noise is 0.02-0.04 g)
TOUCH_LO, TOUCH_HI = 0.2, 0.8  # touch is the rise (or fall) between 20 % and 80 % of the peak, over the time it took
TOUCH_MIN_BINS = 1.5         # a rise over fewer 5 m bins than this is quicker than the recording can time ("quick")
FINE_EPS = 3e-4              # g: two readings this close (or three in a straight line) are one reading spread out...
FINE_FLAT = 0.3              # ...and when this share of a stretch is, its g was kept once a second: no touch from it


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


def _fine(x: list) -> bool:
    """True when x (g, one value a bin) moves like ten readings a second, not like one a second spread over the bins
    between two fixes: older recordings repeat a fix's g (a staircase) or run straight between fixes (a ramp)."""
    if len(x) < 4:
        return False
    flat = 0
    for i in range(1, len(x) - 1):
        if abs(x[i] - x[i - 1]) <= FINE_EPS or abs(x[i + 1] - 2.0 * x[i] + x[i - 1]) <= FINE_EPS:
            flat += 1
    return flat < FINE_FLAT * (len(x) - 2)


def _cross(y: list, t: list, j: int, k: int, level: float) -> tuple:
    """(time, fractional bin) where y passes level between bins j and k (neighbours), linear between them."""
    f = _clamp01((level - y[j]) / (y[k] - y[j]) if y[k] != y[j] else 0.0)
    return t[j] + f * (t[k] - t[j]), j + f * (k - j)


QUICK = "quick"


def _touch(y: list, t: list, pk: int, way: int):
    """Rate in g a second at which y (load towards its peak, positive) rose to its peak at pk (way -1: walking back) or
    fell from it (way +1), between TOUCH_LO and TOUCH_HI of the peak. QUICK when that took under TOUCH_MIN_BINS bins (the
    5 m bins cannot time it; a rate read off them would come out too low), None when it does not get there inside y."""
    p, at = y[pk], {}
    j = pk
    for level in (TOUCH_HI, TOUCH_LO):
        while 0 <= j + way < len(y) and y[j + way] >= level * p:
            j += way
        if not 0 <= j + way < len(y):
            return None
        at[level] = _cross(y, t, j + way, j, level * p)
    if abs(at[TOUCH_HI][1] - at[TOUCH_LO][1]) < TOUCH_MIN_BINS:
        return QUICK
    dt = (at[TOUCH_HI][0] - at[TOUCH_LO][0]) * -way
    return None if dt <= 0 else (TOUCH_HI - TOUCH_LO) * p / dt


def _measured(v, known, w0: int, w1: int) -> bool:
    """Every bin w0..w1 has its g measured (g_known, where the drive says) and the car moving at a known speed: a
    blanked g reads as a sudden 0 g, and a stopped or unknown bin takes no time, so either would make a false rate."""
    for q in range(w0, w1 + 1):
        if known is not None and not known[q]:
            return False
        if not (math.isfinite(v[q]) and v[q] >= da.STOPPED_MPS):
            return False
    return True


def _corner_touch(lon, lat, t: list, s: int, e: int, a: int, run, first, v, known=None):
    """(brake_on, brake_off, turn_in) in g a second for one corner, each QUICK when quicker than the bins can time and
    None when it cannot be told (its window not all measured, moving, and read ten times a second)."""
    n = len(lat)
    on = off = turn = None
    if run is not None:
        w0, w1 = max(0, first - SQUEEZE_GAP), min(n - 1, run[1] + SQUEEZE_GAP)
        dec = [-float(lon[q]) for q in range(w0, w1 + 1)]
        if all(math.isfinite(x) for x in dec) and _measured(v, known, w0, w1) and _fine(dec):
            r0, r1 = first - w0, run[1] - w0
            pk = max(range(r0, r1 + 1), key=lambda i: (dec[i], -i))
            if dec[pk] >= TOUCH_MIN_G:
                tt = t[w0:w1 + 1]
                on, off = _touch(dec, tt, pk, -1), _touch(dec, tt, pk, 1)
    w0 = max(0, s - da.TURN_LEAD)
    side = [float(lat[q]) for q in range(w0, e + 1)]
    if all(math.isfinite(x) for x in side) and _measured(v, known, w0, e) and _fine(side):
        pk = max(range(s - w0, e - w0 + 1), key=lambda i: (abs(side[i]), -i))
        way = 1.0 if side[pk] > 0 else -1.0
        y = [way * x for x in side]
        if y[pk] >= TOUCH_MIN_G:
            turn = _touch(y, t[w0:e + 1], pk, -1)
    return on, off, turn


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
        first = None
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
        brake_on, brake_off, turn_in = _corner_touch(lon, lat, t, s, e, a, run, first, v, drive.get("g_known"))
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
            "brake_on": brake_on, "brake_off": brake_off, "turn_in": turn_in,
            "pace": da._pace_credit(float(tech["use"])),
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
    out = {"corners": len(every), "drives": len(drives), "skills": {}, "style": {}, "touch": {}, "matrix": [], "findings": [],
           "pace_findings": [], "pace": {},
           "touch_by": {}, "touch_trend": {}, "trend": {}, "change": {}, "strongest": None, "focus": None}

    overall = {}
    for k in MEASURES:
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
    out["touch"] = touch(every)
    # touch by size of corner (a tight corner takes the brakes on harder) and month by month: facts, never a level
    out["touch_by"] = {size: touch([o for o in every if o["size"] == size], MATRIX_MIN) for size in ("tight", "medium", "fast")}

    by_size = {}                                   # each skill's mean for each size of corner (None: size unknown)
    for size in ("tight", "medium", "fast", None):
        cell = [o for o in every if o["size"] == size]
        for k in MEASURES:
            xs = _vals(cell, k)
            by_size[(k, size)] = da._mean_se(xs)[0] if xs else 0.0
    for way in ("L", "R"):
        for size in ("tight", "medium", "fast"):
            cell = [o for o in every if o["dir"] == way and o["size"] == size]
            levels = {}
            for k in MEASURES:
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

    for k in MEASURES:
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
    found.sort(key=lambda f: (-abs(f["z"]) if f["z"] is not None else -math.inf, f["split"], str(f["a"]), MEASURES.index(f["skill"])))
    # technique and pace are said apart: "the same shows in pace" would join a fault to a speed
    for name, group in (("findings", [f for f in found if f["skill"] != PACE]), ("pace_findings", [f for f in found if f["skill"] == PACE])):
        seen, kept = {}, []
        for f in group:
            key = (f["split"], f["a"])
            if key in seen:
                seen[key]["also"].append(f["skill"])
                continue
            f = {**f, "also": [], "z": None if f["z"] is None else da._r(f["z"], 2)}
            seen[key] = f
            kept.append(f)
        out[name] = kept[:TOP_FINDINGS]
    over = [1 if o["use"] > da.PACE_CEILING else 0 for o in every]
    out["pace"] = {"over": da._r(da._mean_se(over)[0], 4) if len(over) >= SKILL_MIN else None, "n": len(over)}

    months = sorted({d["month"] for d in drives if d.get("month")})
    out["touch_trend"] = {k: [] for k in TOUCH}
    for mth in months:
        t = touch([o for d in drives if d.get("month") == mth for o in d["obs"]], TREND_MIN)
        for k in TOUCH:
            if t[k]["n"] >= TREND_MIN:
                out["touch_trend"][k].append({"month": mth, "rate": t[k]["rate"], "quick": t[k]["quick_rate"], "n": t[k]["n"]})
    for k in MEASURES:
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


TOUCH = ("brake_on", "brake_off", "turn_in")


def touch(obs: list, least: int = STYLE_MIN) -> dict:
    """The touch over corners obs: per measure {rate, lo, hi, n, quick}: the median and quartiles in g a second over the n
    corners read, a quick one ranking above every rate (it is quicker than any the bins can time); a statistic that lands
    among the quick ones is None and quick_rate (rate's) True. None everywhere under `least` corners. release: the median
    of brakes off over brakes on, on corners with both timed (None likewise)."""
    out = {}
    for k in TOUCH:
        xs = sorted(o[k] for o in obs if isinstance(o.get(k), float))
        q = sum(1 for o in obs if o.get(k) == QUICK)
        n, ok = len(xs) + q, len(xs) + q >= least
        at = lambda f: _rank(xs, n, f) if ok else None
        out[k] = {"rate": at(0.5), "lo": at(0.25), "hi": at(0.75), "n": n, "quick": q,
                  "quick_rate": bool(ok and at(0.5) is None)}
    both = [o["brake_off"] / o["brake_on"] for o in obs if isinstance(o.get("brake_on"), float) and isinstance(o.get("brake_off"), float)]
    out["release"] = da._r(da._median(both), 3) if len(both) >= least else None
    out["release_n"] = len(both)
    return out


def drive_touch(obs: list, others: list) -> dict:
    """A drive's own touch (its Log page): {drive: touch over its corners (from DRIVE_TOUCH_MIN), usual: touch over the
    corners of every other drive (from STYLE_MIN)}. Facts side by side; a drive is never marked better or worse for it."""
    return {"drive": touch(obs, DRIVE_TOUCH_MIN), "usual": touch(others)}


def _rank(xs: list, n: int, f: float):
    """The f quantile of n values of which sorted xs are the lowest (the rest quick), linear between ranks (numpy's
    default); None when it reaches into the quick ones."""
    pos = f * (n - 1)
    i = int(math.floor(pos))
    hi = min(i + 1, n - 1)
    if hi >= len(xs) and pos > i or i >= len(xs):
        return None
    return da._r(xs[i] + (xs[hi] - xs[i]) * (pos - i) if hi < len(xs) else xs[i], 3)


# Practice (IDEAS D-27): the skill "Work on" names, carried into the next drives. A plan is {skill, since, where}: since
# is the moment it was set, in the drives' own local "YYYY-MM-DDTHH:MM" form; where is the focus's place, if any. Each
# drive after it is read on that one skill alone and set against every corner before it.
PRACTICE_MIN = 4             # corners of the skill one drive needs before it says how the practice went
PRACTICE_FLOOR = 0.05        # a change smaller than this is not worth saying
PRACTICE_SE = 2.0            # ...and it must be this many standard errors from the level before the practice
GENERIC = frozenset({"rest", "later", "before"})


def _side(where):
    """The test for the corners a focus's place names (lefts, tight corners, downhill...); None for none, a whole-drive
    place (a car, a tag) or one that is only "the rest"."""
    if not where or where.get("worse") in GENERIC:
        return None
    for split, a, b, in_a, in_b in WITHIN:
        if split == where.get("split"):
            if a == where.get("worse"):
                return in_a
            if b == where.get("worse"):
                return in_b
    return None


def _against(xs: list, base):
    """(level, delta in levels, sure) of corners xs against base (mean, se) of the corners before; delta None without one."""
    m, se = da._mean_se(xs)
    if base is None:
        return _level(m), None, False
    diff, s = m - base[0], math.sqrt(se * se + base[1] * base[1])
    return _level(m), _level(m) - _level(base[0]), bool(abs(diff) >= PRACTICE_FLOOR and abs(diff) >= PRACTICE_SE * s)


def drive_practice(obs: list, plan: dict, base=None):
    """One drive on the practised skill. base: (mean, se) of every corner before the practice, or None.

    Returns {skill, n, level, delta, sure, where_n, where_level}: level None under PRACTICE_MIN corners; delta (against the
    level before) None without one; where_* the same over the corners of the focus's place. None for an unknown skill.
    """
    k = plan.get("skill") if plan else None
    if k not in SKILLS:
        return None
    xs = _vals(obs, k)
    out = {"skill": k, "n": len(xs), "level": None, "delta": None, "sure": False, "where_n": None, "where_level": None}
    if len(xs) >= PRACTICE_MIN:
        out["level"], out["delta"], out["sure"] = _against(xs, base)
    side = _side(plan.get("where"))
    if side is not None:
        ws = [o[k] for o in obs if o[k] is not None and side(o)]
        out["where_n"] = len(ws)
        if len(ws) >= PRACTICE_MIN:
            out["where_level"] = _level(da._mean_se(ws)[0])
    return out


def practice(drives: list, plan: dict):
    """The practice so far. drives: profile's, each with at (its local start, "YYYY-MM-DDTHH:MM", or None: unknown, and
    counted before). Returns {skill, since, before {level, n, mean, se}, after {level, n}, delta, sure, drives [{id, at,
    ...drive_practice}]}, or None for no plan. Every corner of a drive that started before since is "before"."""
    k = plan.get("skill") if plan else None
    if k not in SKILLS:
        return None
    since = str(plan.get("since") or "")
    order = sorted((d for d in drives if d.get("obs")), key=lambda d: (d.get("at") or "", str(d.get("id"))))
    before, after, rows = [], [], []
    for d in order:
        xs = _vals(d["obs"], k)
        if d.get("at") and d["at"] >= since:
            after.extend(xs)
            if xs:
                rows.append(d)
        else:
            before.extend(xs)
    base = None
    out = {"skill": k, "since": since, "before": {"level": None, "n": len(before), "mean": None, "se": None},
           "after": {"level": None, "n": len(after)}, "delta": None, "sure": False, "drives": []}
    if len(before) >= SKILL_MIN:
        m, se = da._mean_se(before)
        base = (da._r(m, 4), da._r(se, 4))          # as the plan keeps it for the end card, so both say the same
        out["before"].update(level=_level(base[0]), mean=base[0], se=base[1])
    if len(after) >= PRACTICE_MIN:
        out["after"]["level"], out["delta"], out["sure"] = _against(after, base)
    out["drives"] = [{"id": d.get("id"), "at": d.get("at"), **drive_practice(d["obs"], plan, base)} for d in rows]
    return out
