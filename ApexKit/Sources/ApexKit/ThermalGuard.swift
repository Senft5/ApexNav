import Foundation

/// Thermal guard (docs/IDEAS.md P-07): a phone baking on the dash pauses the 100 Hz motion pipeline instead of letting iOS
/// throttle or kill the app. GPS, the map and pace notes carry on; bumps, banking and g are recorded as unknown while paused
/// and for a short settle after resuming (the filters restart from stale state). Pure, so it is tested on Linux.
/// Levels follow ProcessInfo.ThermalState: 0 nominal, 1 fair, 2 serious, 3 critical.
public struct ThermalGuard: Sendable {
    public static let pauseLevel = 3     // critical: iOS is about to throttle hard
    public static let resumeLevel = 1    // fair or cooler; serious keeps a paused pipeline paused (no flapping)
    public static let settleS = 3.0      // IMU values stay unknown this long after resuming

    public private(set) var paused = false
    public private(set) var level = 0
    var resumedAt: Double?

    public init() {}

    /// A new thermal level at time t (s). Returns true when `paused` changed: the shell then stops or restarts CoreMotion.
    public mutating func update(level: Int, t: Double) -> Bool {
        self.level = level
        if !paused && level >= Self.pauseLevel { paused = true; resumedAt = nil; return true }
        if paused && level <= Self.resumeLevel { paused = false; resumedAt = t; return true }
        return false
    }

    /// Whether motion-derived values (g, camber, crest, roughness) can be trusted at time t.
    public func imuLive(t: Double) -> Bool {
        if paused { return false }
        if let r = resumedAt, t - r < Self.settleS { return false }
        return true
    }
}
