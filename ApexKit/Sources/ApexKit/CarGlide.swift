import Foundation

/// Where the car's arrow is drawn between GPS fixes (REVIEW_FEEL.md F-01): dead reckoning for the native car map
/// (CarPlay/ApexCarMap.swift, on a CADisplayLink). The same algorithm as web/car_glide.js, held to it by
/// Tests/Fixtures/car_glide.json (tools/make_glide_fixture.js): from the last fix at its speed, along the route line when the
/// car is on it (so a corner is followed, not cut), else along its course; never more than `capS` or `capM` past the fix;
/// eased into each new fix instead of jumping to it. Position only: no road value is ever predicted.
///
/// Times are seconds on one monotonic clock; angles are degrees clockwise from north; distances metres.
public struct CarGlide: Sendable {
    public static let capS = 1.5          // never predict more than this long past a fix
    public static let capM = 50.0         // ...or this far
    public static let easeS = 0.8         // how long the drawn car takes to ease into a new fix (a smoothstep)
    public static let easeMaxS = 2.0      // the slowest ease (a car that stopped short of its prediction)
    public static let jumpM = 400.0       // a fix this far from the drawn car is drawn at once
    public static let snapM = 25.0        // a fix this near the route line is on it
    public static let agreeDeg = 75.0     // ...if it is heading the line's way (a road that doubles back)
    public static let chordM = 12.0       // the arrow's heading on the route: the chord across this much road
    public static let minMps = 0.5        // slower than this the car is standing
    static let windowBack = 5, windowAhead = 80
    static let kLat = 110540.0, kLon = 111320.0

    /// Where to draw the car. `course` is nil when unknown; `s` is metres along the route, nil off it.
    public struct Pose: Sendable, Equatable {
        public var lat: Double
        public var lon: Double
        public var course: Double?
        public var s: Double?
    }
    struct Fix: Sendable { var lat, lon: Double; var course: Double?; var mps, t: Double }
    struct Route: Sendable {
        var lat: [Double] = [], lon: [Double] = [], x: [Double] = [], y: [Double] = [], s: [Double] = []
        var lat0 = 0.0, lon0 = 0.0, c = 1.0
        var n: Int { lat.count }
        var total: Double { s.last ?? 0 }
    }
    struct Ease: Sendable { var t, dur: Double; var ds: Double?; var dx = 0.0, dy = 0.0, dc = 0.0 }

    var route: Route?
    var fix: Fix?
    var base: (s: Double, i: Int)?
    var ease: Ease?
    var lastI = -1

    public init() {}

    public var hasFix: Bool { fix != nil }
    public var onRoute: Bool { base != nil }

    static func norm(_ d: Double) -> Double { let r = d.truncatingRemainder(dividingBy: 360); return r < 0 ? r + 360 : r }
    /// Degrees from a to b, the short way round (as JavaScript's ((b - a + 540) % 360) - 180).
    public static func turn(_ a: Double, _ b: Double) -> Double { jsMod(b - a + 540, 360) - 180 }
    static func jsMod(_ a: Double, _ b: Double) -> Double { a.truncatingRemainder(dividingBy: b) }
    static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { max(lo, min(hi, v)) }
    /// Metres between two points (the equirectangular approximation web/carmap.js uses).
    public static func metres(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Double {
        hypot((bLon - aLon) * kLon * cos(aLat * .pi / 180), (bLat - aLat) * kLat)
    }
    static func bearing(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Double {
        norm(atan2((bLon - aLon) * kLon * cos(aLat * .pi / 180), (bLat - aLat) * kLat) * 180 / .pi)
    }

    /// The route line as [lat, lon] pairs; the car stays where it is drawn at `now`, then eases onto the new line.
    public mutating func setRoute(_ coords: [(lat: Double, lon: Double)], now: Double) {
        let pts = coords.filter { $0.lat.isFinite && $0.lon.isFinite }
        var drawn = fix != nil && now.isFinite ? pose(at: now) : nil
        route = nil; lastI = -1
        if pts.count >= 2 {
            var r = Route()
            r.lat0 = pts[0].lat; r.lon0 = pts[0].lon; r.c = cos(r.lat0 * .pi / 180)
            for (i, p) in pts.enumerated() {
                r.lat.append(p.lat); r.lon.append(p.lon)
                r.x.append((p.lon - r.lon0) * Self.kLon * r.c); r.y.append((p.lat - r.lat0) * Self.kLat)
                r.s.append(i == 0 ? 0 : r.s[i - 1] + hypot(r.x[i] - r.x[i - 1], r.y[i] - r.y[i - 1]))
            }
            route = r
        }
        if let f = fix {
            base = snap(f)
            if drawn != nil { drawn!.s = nil; startEase(from: drawn!, now: now) }
        }
    }

    mutating func snap(_ f: Fix) -> (s: Double, i: Int)? {
        guard let r = route else { return nil }
        let px = (f.lon - r.lon0) * Self.kLon * r.c, py = (f.lat - r.lat0) * Self.kLat
        let heading = f.course != nil && f.mps >= 2
        func best(_ lo: Int, _ hi: Int) -> (i: Int, s: Double, d: Double)? {
            var b: (i: Int, s: Double, d: Double)?
            var i = lo
            while i < hi {
                let ax = r.x[i], ay = r.y[i], vx = r.x[i + 1] - ax, vy = r.y[i + 1] - ay, l2 = vx * vx + vy * vy
                let u = l2 > 0 ? Self.clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1) : 0
                let d = hypot(ax + u * vx - px, ay + u * vy - py)
                if d > Self.snapM || (b != nil && d >= b!.d) { i += 1; continue }
                if heading, l2 > 0.01, let c = f.course, abs(Self.turn(Self.norm(atan2(vx, vy) * 180 / .pi), c)) > Self.agreeDeg { i += 1; continue }
                b = (i, r.s[i] + u * l2.squareRoot(), d)
                i += 1
            }
            return b
        }
        var hit = lastI >= 0 ? best(max(0, lastI - Self.windowBack), min(r.n - 1, lastI + Self.windowAhead)) : nil
        if hit == nil { hit = best(0, r.n - 1) }
        lastI = hit?.i ?? -1
        return hit.map { (s: $0.s, i: $0.i) }
    }

    func along(_ s0: Double) -> (lat: Double, lon: Double, s: Double) {
        let r = route!
        let s = Self.clamp(s0, 0, r.total)
        var lo = 0, hi = r.n - 1
        while hi - lo > 1 { let mid = (lo + hi) >> 1; if r.s[mid] <= s { lo = mid } else { hi = mid } }
        let l = r.s[hi] - r.s[lo], u = l > 0 ? (s - r.s[lo]) / l : 0
        return (r.lat[lo] + (r.lat[hi] - r.lat[lo]) * u, r.lon[lo] + (r.lon[hi] - r.lon[lo]) * u, s)
    }
    func heading(at s: Double) -> Double? {
        let a = along(s - Self.chordM), b = along(s + Self.chordM)
        return a.lat == b.lat && a.lon == b.lon ? nil : Self.bearing(a.lat, a.lon, b.lat, b.lon)
    }

    func ahead(_ t: Double) -> Double {
        guard let f = fix, f.mps >= Self.minMps else { return 0 }
        return min(f.mps * Self.clamp(t - f.t, 0, Self.capS), Self.capM)
    }

    func predicted(_ t: Double) -> Pose {
        let f = fix!, a = ahead(t)
        if let b = base { let p = along(b.s + a); return Pose(lat: p.lat, lon: p.lon, course: heading(at: p.s), s: p.s) }
        guard a > 0, let c = f.course else { return Pose(lat: f.lat, lon: f.lon, course: f.course, s: nil) }
        return Pose(lat: f.lat + a * cos(c * .pi / 180) / Self.kLat, lon: f.lon + a * sin(c * .pi / 180) / (Self.kLon * cos(f.lat * .pi / 180)), course: c, s: nil)
    }

    /// Where to draw the car at time t, nil before the first fix.
    public func pose(at t: Double) -> Pose? {
        guard fix != nil else { return nil }
        let p = predicted(t)
        guard let o = ease else { return p }
        let k = Self.clamp((t - o.t) / o.dur, 0, 1), e = 1 - k * k * (3 - 2 * k)   // what is left of the correction
        if let ds = o.ds, let s = p.s { let q = along(s + ds * e); return Pose(lat: q.lat, lon: q.lon, course: heading(at: q.s), s: q.s) }
        return Pose(lat: p.lat + o.dy * e / Self.kLat, lon: p.lon + o.dx * e / (Self.kLon * cos(p.lat * .pi / 180)),
                    course: p.course.map { Self.norm($0 + o.dc * e) }, s: p.s)   // the prediction's s: the ease is all but spent by the next fix
    }

    mutating func startEase(from drawn: Pose, now: Double) {
        let p = predicted(now)
        ease = nil
        guard Self.metres(drawn.lat, drawn.lon, p.lat, p.lon) <= Self.jumpM else { return }
        if base != nil, let ds0 = drawn.s, let ps = p.s {
            let ds = ds0 - ps
            // drawn ahead of the new prediction (the car slowed): ease back no faster than the car moves (a smoothstep's
            // steepest is 1.5 times its average), so the arrow never runs backwards along the road; within easeMaxS even if
            // the car stopped
            let dur = ds > 0 ? Self.clamp(1.5 * ds / max(fix!.mps, 0.1), Self.easeS, Self.easeMaxS) : Self.easeS
            ease = Ease(t: now, dur: dur, ds: ds)
        } else {
            let dx = (drawn.lon - p.lon) * Self.kLon * cos(p.lat * .pi / 180), dy = (drawn.lat - p.lat) * Self.kLat
            var dc = 0.0
            if let a = drawn.course, let b = p.course { dc = Self.turn(b, a) }
            ease = Ease(t: now, dur: Self.easeS, ds: nil, dx: dx, dy: dy, dc: dc)
        }
    }

    /// A new fix taken at `t` (the shell knows its age), arriving at `now`. Speed m/s and course degrees may be nil
    /// (unknown): the speed is then the distance from the last fix over the time between them, the course the bearing from it.
    public mutating func push(lat: Double, lon: Double, course: Double?, mps: Double?, t: Double, now: Double) {
        guard lat.isFinite, lon.isFinite else { return }
        let now = now.isFinite ? now : t
        let t = t.isFinite && t <= now ? t : now
        let drawn = fix != nil ? pose(at: now) : nil, prev = fix
        let v: Double
        if let m = mps, m.isFinite, m >= 0 { v = m } else if let p = prev {
            let dt = t - p.t
            // measured between two fixes whose times are only their arrival: half of it, half the last speed
            v = dt >= 0.2 && dt <= 3 ? (p.mps > 0 ? 0.5 * p.mps : 0) + (p.mps > 0 ? 0.5 : 1) * Self.metres(p.lat, p.lon, lat, lon) / dt : p.mps
        } else { v = 0 }
        let c: Double?
        if let k = course, k.isFinite, k >= 0 { c = Self.norm(k) } else if let p = prev, v >= Self.minMps, Self.metres(p.lat, p.lon, lat, lon) > 2 {
            c = Self.bearing(p.lat, p.lon, lat, lon)
        } else { c = drawn?.course }
        fix = Fix(lat: lat, lon: lon, course: c, mps: v, t: t)
        base = snap(fix!)
        if let d = drawn { startEase(from: d, now: now) } else { ease = nil }
    }

    /// Whether the drawn car is still moving at time t (the display link can pause when it is not).
    public func moving(at t: Double) -> Bool {
        guard let f = fix else { return false }
        if f.mps >= Self.minMps && t - f.t < Self.capS { return true }
        if let o = ease { return t - o.t < o.dur }
        return false
    }

    public mutating func reset() { fix = nil; base = nil; ease = nil; lastI = -1 }
}
