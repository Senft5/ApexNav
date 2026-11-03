import Foundation

/// Causal 100 Hz estimators in the ISO 8855 vehicle frame. Mirrors core/live_pipeline.IMUPipeline.
public struct IMUPipeline: Sendable {
    public var mount = MountCalibrator()
    var lastTimestamp: Double?
    public private(set) var lonAccMps2 = 0.0     // +X forward
    public private(set) var latAccMps2 = 0.0     // +Y left
    public private(set) var yawRateRadS = 0.0    // about +Z up
    public private(set) var crestAccMps2 = 0.0   // < 1 Hz vertical (gravity removed)
    public private(set) var hpVert = 0.0         // > 8 Hz vertical
    public private(set) var vertPeakMps2 = 0.0   // max |hpVert| since the last take (pothole/bump spikes)
    var lastAzVeh = 0.0
    public private(set) var roughMeanSq = 0.0    // EMA of hpVert^2, (m/s^2)^2
    var segRoughSumSq = 0.0
    var segRoughCount = 0
    /// Turn-relative bank (rad), or nil when it has not been observed in the last `camberHoldS` (never a made-up 0).
    public private(set) var camberRad: Double?
    var camberAt: Double?                         // sensor time of the last camber observation
    /// Camber is observable only under cornering load (|v * yaw rate| > camberGateMps2); see core/live_pipeline.CAMBER_HOLD_S.
    public static let camberGateMps2 = 1.5
    public static let camberHoldS = 1.0
    /// Written with every frame as `camber_v`: camber from this pipeline (unknown when unobserved). Frames, rows and
    /// uploads without it come from builds whose camber decayed to a placeholder 0 on straights, and their camber is not used.
    public static let camberVersion = 2
    public private(set) var engagement = 0.0

    public init() {}

    /// accel: proper acceleration with gravity removed, phone frame, m/s^2. gyro: rad/s. gravityG: CoreMotion gravity,
    /// phone frame, g (points down), or nil. speedMps: latest GPS speed (held between fixes).
    public mutating func step(accel a: Vec3, gyro w: Vec3, timestamp: Double, speedMps: Double, gravityG: Vec3? = nil) {
        var dt = 0.01
        if let last = lastTimestamp { dt = max(0.001, min(0.1, timestamp - last)) }
        lastTimestamp = timestamp

        mount.observe(accel: a, gyro: w, gravityG: gravityG, dt: dt, speedMps: speedMps)

        let ax = mount.rX.dot(a), ay = mount.rY.dot(a), az = mount.rZ.dot(a)
        let yaw = mount.rZ.dot(w)

        let aH = lowPassAlpha(dt: dt, tau: 0.15)
        lonAccMps2 += aH * (ax - lonAccMps2)
        latAccMps2 += aH * (ay - latAccMps2)
        yawRateRadS += aH * (yaw - yawRateRadS)

        crestAccMps2 += lowPassAlpha(dt: dt, tau: 1.0 / (2.0 * .pi * 1.0)) * (az - crestAccMps2)

        let rc = 1.0 / (2.0 * .pi * 8.0)
        let beta = rc / (rc + dt)
        hpVert = beta * (hpVert + az - lastAzVeh)
        lastAzVeh = az
        vertPeakMps2 = max(vertPeakMps2, abs(hpVert))
        let sq = hpVert * hpVert
        roughMeanSq += lowPassAlpha(dt: dt, tau: 0.5) * (sq - roughMeanSq)
        segRoughSumSq += sq
        segRoughCount += 1

        // a_y = v w_z cos(phi) - g sin(phi), turn-relative (same gating as core/kinematics.py)
        // Observed only while cornering; held camberHoldS after the last observation, then unknown (nil, never 0).
        let aKin = speedMps * yawRateRadS
        if abs(aKin) > Self.camberGateMps2 {
            let sinPhi = max(-0.5, min(0.5, (abs(aKin) - abs(latAccMps2)) / gStd))
            let phi = asin(sinPhi)
            if let c = camberRad {
                camberRad = c + lowPassAlpha(dt: dt, tau: 0.3) * (phi - c)
            } else {
                camberRad = phi
            }
            camberAt = timestamp
        } else if let at = camberAt, !(timestamp - at >= 0 && timestamp - at <= Self.camberHoldS) {
            camberRad = nil
            camberAt = nil
        }

        let combinedG = hypot(latAccMps2, lonAccMps2) / gStd
        let roughG = sqrt(max(0.0, roughMeanSq)) / gStd
        engagement = min(1.0, (combinedG / 0.75) * 0.75 + (roughG / 0.45) * 0.25)
    }

    /// Roughness RMS accumulated since the last 5 m node (m/s^2).
    public var segmentRoughRMS: Double {
        segRoughCount > 0 ? sqrt(segRoughSumSq / Double(segRoughCount)) : sqrt(max(0.0, roughMeanSq))
    }

    /// Peak |>8 Hz vertical| since the last call (m/s^2), then start a new window.
    public mutating func takeVertPeak() -> Double {
        let peak = vertPeakMps2
        vertPeakMps2 = 0.0
        return peak
    }

    public mutating func resetSegmentRough() {
        segRoughSumSq = 0.0
        segRoughCount = 0
    }

    public var roughRMSMps2: Double { sqrt(max(0.0, roughMeanSq)) }

    /// Same order as core/live_pipeline.IMUPipeline.outputs(); camber is nil when unknown.
    public var outputs: [Double?] {
        [lonAccMps2, latAccMps2, yawRateRadS, crestAccMps2, hpVert, roughMeanSq, camberRad, engagement, vertPeakMps2]
    }
}
