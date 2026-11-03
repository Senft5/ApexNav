// Panel round 2 NA-2 (docs/design/panel/round-2/na.md): the drive sensor stack (100 Hz IMU, barometer, best-for-navigation
// GPS) runs only while driving. An idle map gets coarse location and nothing else. The stack is promoted at a drive's
// Start, while the phone is in the car, or once the car is moving at road speed (so the ambient road-feel sharer still
// sees a drive nobody started), and demoted only after `demoteAfterS` stopped with none of those. IMU values stay
// unknown for `settleS` after a promotion, as after a thermal pause. Specification: core/live_pipeline.py SensorStack.
public struct SensorStack: Sendable {
    public static let atSpeedMps = 8.0       // web/cockpit.js AT_SPEED_MPS: road speed, a drive whether or not it was started
    public static let stoppedMps = 2.0       // under this, the car is stopped
    public static let demoteAfterS = 300.0   // five minutes stopped, not driving, not in the car: back to idle
    public static let settleS = 3.0          // IMU values stay unknown this long after the stack starts

    public private(set) var full = false
    var stoppedSince: Double?
    var promotedAt: Double?

    public init() {}

    /// The phone's state at time t (s): whether a drive is on (the page's Start, or recording), whether the phone is in the
    /// car, and the latest GPS speed (nil when unknown). Returns true when `full` changed: the shell then starts or stops
    /// the IMU and barometer and switches the GPS accuracy.
    public mutating func update(driving: Bool, inCar: Bool, speedMps: Double?, t: Double) -> Bool {
        let moving = (speedMps ?? 0) >= Self.stoppedMps
        if driving || inCar || (speedMps ?? 0) >= Self.atSpeedMps {
            stoppedSince = nil
            guard !full else { return false }
            full = true; promotedAt = t
            return true
        }
        guard full else { return false }
        if moving { stoppedSince = nil; return false }
        let since = stoppedSince ?? t
        stoppedSince = since
        guard t - since >= Self.demoteAfterS else { return false }
        full = false; promotedAt = nil; stoppedSince = nil
        return true
    }

    /// Whether the IMU is running and settled at time t: g, camber, crest and roughness can be trusted.
    public func imuLive(t: Double) -> Bool {
        guard full else { return false }
        if let p = promotedAt, t - p < Self.settleS { return false }
        return true
    }
}
