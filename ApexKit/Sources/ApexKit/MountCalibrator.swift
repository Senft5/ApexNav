import Foundation

/// Phone-to-vehicle rotation (ISO 8855 rows), calibrated automatically and continuously.
/// Mirrors core/live_pipeline.MountCalibrator operation for operation (see its comment for the method).
///   default       no trusted rotation (start, handheld, remounting): outputs are unknown
///   awaitingPull  vertical known from steady gravity, forward not yet
///   locked        vertical and forward known
public struct MountCalibrator: Sendable {
    public enum State: String, Sendable { case `default`, awaitingPull, locked }

    public var rX = Vec3(x: 1, y: 0, z: 0)
    public var rY = Vec3(x: 0, y: 1, z: 0)
    public var rZ = Vec3(x: 0, y: 0, z: 1)
    public var state: State = .default
    var persisted = false            // rows came from a saved mount: reuse them if gravity agrees
    var gFast: Vec3?                 // gravity, phone frame, g (points down)
    var gSlow: Vec3?
    var offAxisRate = 0.0            // low-passed |gyro| not about the vertical, rad/s
    var settledS = 0.0
    var settledSum = Vec3.zero
    var movedS = 0.0
    var ivT = 0.0                    // current GPS speed interval
    var ivH = Vec3.zero
    var ivYaw = 0.0
    var ivV0: Double?
    var evA = Vec3.zero              // forward evidence: sum of (a_ref * horizontal accel) * T
    var evW = 0.0                    // sum of a_ref^2 * T
    var evN = 0
    var disW = 0.0                   // consecutive evidence disagreeing with the locked X
    var disN = 0

    static let gFastTau = 0.1
    static let gSlowTau = 0.8
    static let offAxisTau = 0.2
    static let settleAngle = 3.0 * (Double.pi / 180.0)
    static let settleRate = 0.15
    static let settleS = 2.0
    static let remountAngle = 15.0 * (Double.pi / 180.0)
    static let remountRate = 0.5
    static let remountS = 0.5
    static let trimTau = 30.0
    static let persistMatch = 8.0 * (Double.pi / 180.0)
    static let ivMinS = 0.8
    static let ivMaxS = 3.0
    static let evTau = 90.0
    static let minSpeed = 3.0
    static let lonMin = 0.5
    static let latMin = 1.0
    static let lonGate = 0.5         // |dv/dt| below this for turn evidence
    static let latGate = 0.7         // |v * yaw| below this for straight-line evidence
    static let aMax = 8.0            // beyond what a car does: a GPS speed jump after a dropout, not evidence
    static let wLock = 6.0
    static let nLock = 3
    static let qLock = 0.7
    static let qLost = 0.3
    static let disagreeCos = cos(45.0 * (Double.pi / 180.0))

    public init() {}

    /// Rows known to be right (tests): locked.
    public init(rows: [Double]) {
        rX = Vec3(x: rows[0], y: rows[1], z: rows[2])
        rY = Vec3(x: rows[3], y: rows[4], z: rows[5])
        rZ = Vec3(x: rows[6], y: rows[7], z: rows[8])
        state = .locked
    }

    public var rows: [Double] { [rX.x, rX.y, rX.z, rY.x, rY.y, rY.z, rZ.x, rZ.y, rZ.z] }

    /// A mount saved from an earlier drive: the starting frame, trusted only once gravity confirms it.
    public mutating func restore(rows: [Double]) {
        rX = Vec3(x: rows[0], y: rows[1], z: rows[2])
        rY = Vec3(x: rows[3], y: rows[4], z: rows[5])
        rZ = Vec3(x: rows[6], y: rows[7], z: rows[8])
        state = .default
        persisted = true
    }

    /// Manual vertical lock (+Z_veh = -gravity; CoreMotion gravity points down) now; forward follows from driving.
    public mutating func lockVertical(gravityG: Vec3) {
        setVertical(gravityG.scaled(-1.0).normalized())
        persisted = false
        resetEvidence()
    }

    mutating func setVertical(_ up: Vec3) {
        rZ = up
        let seed = abs(rZ.y) < 0.9 ? Vec3(x: 0, y: 1, z: 0) : Vec3(x: 0, y: 0, z: -1)
        rX = seed.rejecting(rZ).normalized()
        rY = rZ.cross(rX).normalized()
        state = .awaitingPull
    }

    mutating func resetEvidence() {
        evA = .zero; evW = 0.0; evN = 0
        disW = 0.0; disN = 0
        ivT = 0.0; ivH = .zero; ivYaw = 0.0; ivV0 = nil
    }

    static func angle(_ a: Vec3, _ b: Vec3) -> Double { atan2(a.cross(b).magnitude, a.dot(b)) }

    /// One 100 Hz sample. gravityG nil (no attitude) leaves the vertical as it is.
    public mutating func observe(accel a: Vec3, gyro w: Vec3, gravityG: Vec3?, dt: Double, speedMps: Double) {
        if let g = gravityG { trackGravity(gyro: w, gravity: g, dt: dt) }
        if state != .default { forwardEvidence(accel: a, gyro: w, dt: dt, v: speedMps) }
    }

    mutating func trackGravity(gyro w: Vec3, gravity g: Vec3, dt: Double) {
        if gFast == nil { gFast = g; gSlow = g }
        var fast = gFast!, slow = gSlow!
        fast = fast.plus(g.minus(fast).scaled(lowPassAlpha(dt: dt, tau: Self.gFastTau)))
        slow = slow.plus(g.minus(slow).scaled(lowPassAlpha(dt: dt, tau: Self.gSlowTau)))
        gFast = fast; gSlow = slow
        let up = fast.scaled(-1.0).normalized()
        offAxisRate += lowPassAlpha(dt: dt, tau: Self.offAxisTau) * (w.rejecting(up).magnitude - offAxisRate)
        let steady = Self.angle(fast, slow) < Self.settleAngle && offAxisRate < Self.settleRate
        if steady {
            settledS += dt
            settledSum = settledSum.plus(g.scaled(dt))
        } else {
            settledS = 0.0; settledSum = .zero
        }
        if state == .default {
            if settledS >= Self.settleS { settleVertical() }
            return
        }
        let moved = Self.angle(up, rZ) > Self.remountAngle || offAxisRate > Self.remountRate
        movedS = moved ? movedS + dt : 0.0
        if movedS >= Self.remountS {
            state = .default; persisted = false; movedS = 0.0
            resetEvidence()
            return
        }
        if steady {   // follow slow trim of the mount (and of the road on average)
            rZ = rZ.plus(up.minus(rZ).scaled(lowPassAlpha(dt: dt, tau: Self.trimTau))).normalized()
            rX = rX.rejecting(rZ).normalized()
            rY = rZ.cross(rX).normalized()
        }
    }

    mutating func settleVertical() {
        let up = settledSum.scaled(-1.0).normalized()
        if persisted && Self.angle(up, rZ) < Self.persistMatch {
            rZ = up
            rX = rX.rejecting(up).normalized()
            rY = up.cross(rX).normalized()
            state = .locked
        } else {
            setVertical(up)
        }
        persisted = false; movedS = 0.0
        resetEvidence()
    }

    mutating func forwardEvidence(accel a: Vec3, gyro w: Vec3, dt: Double, v: Double) {
        if ivV0 == nil { ivV0 = v }
        ivH = ivH.plus(a.rejecting(rZ).scaled(dt))
        ivYaw += rZ.dot(w) * dt
        ivT += dt
        let v0 = ivV0!
        guard (v != v0 && ivT >= Self.ivMinS) || ivT >= Self.ivMaxS else { return }
        let T = ivT
        let h = ivH.scaled(1.0 / T)
        let aLon = (v - v0) / T
        let vBar = 0.5 * (v + v0)
        let aLat = vBar * (ivYaw / T)
        ivT = 0.0; ivH = .zero; ivYaw = 0.0; ivV0 = v
        guard vBar >= Self.minSpeed && abs(aLon) <= Self.aMax && abs(aLat) <= Self.aMax else { return }
        let sample: Vec3, weight: Double
        if abs(aLon) >= Self.lonMin && abs(aLat) < Self.latGate {
            sample = h.scaled(aLon * T); weight = aLon * aLon * T
        } else if abs(aLat) >= Self.latMin && abs(aLon) < Self.lonGate {
            sample = h.cross(rZ).scaled(aLat * T); weight = aLat * aLat * T   // h ~ a_lat * Y, Y x Z = X
        } else {
            return
        }
        if state == .locked {   // a phone turned about the vertical: gravity cannot see it, the evidence can
            let sH = sample.rejecting(rZ)
            if sH.dot(rX) >= Self.disagreeCos * sH.magnitude {
                disW = 0.0; disN = 0
            } else {
                disW += weight
                disN += 1
                if disN >= Self.nLock && disW >= Self.wLock {
                    state = .awaitingPull
                    resetEvidence()
                }
            }
        }
        let decay = exp(-T / Self.evTau)
        evA = evA.scaled(decay).plus(sample)
        evW = evW * decay + weight
        evN += 1
        guard evN >= Self.nLock && evW >= Self.wLock else { return }
        let aH = evA.rejecting(rZ)
        let q = aH.magnitude / evW
        if q >= Self.qLock {
            rX = aH.normalized()
            rY = rZ.cross(rX).normalized()
            state = .locked
        } else if q < Self.qLost && state == .locked {
            state = .awaitingPull
            resetEvidence()
        }
    }
}
