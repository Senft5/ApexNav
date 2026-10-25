import Foundation

/// Phone-to-vehicle rotation (ISO 8855 rows): vertical lock from gravity, then forward
/// lock from a sustained straight pull. Mirrors core/live_pipeline.MountCalibrator.
public struct MountCalibrator: Sendable {
    public enum State: String, Sendable { case `default`, awaitingPull, locked }

    public var rX = Vec3(x: 1, y: 0, z: 0)
    public var rY = Vec3(x: 0, y: 1, z: 0)
    public var rZ = Vec3(x: 0, y: 0, z: 1)
    public var state: State = .default
    var pullAccum = Vec3.zero
    var pullSamples = 0

    static let pullMinMps2 = 1.2
    static let pullResetMps2 = 0.5
    static let pullMaxGyro = 0.15
    static let pullSamplesNeeded = 30

    public init() {}

    public init(rows: [Double]) {
        rX = Vec3(x: rows[0], y: rows[1], z: rows[2])
        rY = Vec3(x: rows[3], y: rows[4], z: rows[5])
        rZ = Vec3(x: rows[6], y: rows[7], z: rows[8])
        state = .locked
    }

    public var rows: [Double] { [rX.x, rX.y, rX.z, rY.x, rY.y, rY.z, rZ.x, rZ.y, rZ.z] }

    /// +Z_veh = -gravity (CoreMotion gravity points down); seed X and await the pull.
    public mutating func lockVertical(gravityG: Vec3) {
        rZ = gravityG.scaled(-1.0).normalized()
        let seed = abs(rZ.y) < 0.9 ? Vec3(x: 0, y: 1, z: 0) : Vec3(x: 0, y: 0, z: -1)
        rX = seed.rejecting(rZ).normalized()
        rY = rZ.cross(rX).normalized()
        pullAccum = .zero
        pullSamples = 0
        state = .awaitingPull
    }

    /// Accumulates a straight forward pull; returns true on the sample that locks X.
    @discardableResult
    public mutating func feedPull(accel a: Vec3, gyro w: Vec3) -> Bool {
        let h = a.rejecting(rZ)
        let consistent = pullSamples == 0 || h.dot(pullAccum) > 0
        if h.magnitude > Self.pullMinMps2 && w.magnitude < Self.pullMaxGyro && consistent {
            pullAccum = pullAccum.plus(h)
            pullSamples += 1
            if pullSamples >= Self.pullSamplesNeeded {
                rX = pullAccum.rejecting(rZ).normalized()
                rY = rZ.cross(rX).normalized()
                state = .locked
                pullAccum = .zero
                pullSamples = 0
                return true
            }
        } else if h.magnitude < Self.pullResetMps2 {
            pullAccum = .zero
            pullSamples = 0
        }
        return false
    }
}
