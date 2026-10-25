import Foundation

public let gStd: Double = 9.80665
public let segmentLengthM: Double = 5.0

/// Small SI vector type (phone or vehicle frame).
public struct Vec3: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var z: Double

    public init(x: Double, y: Double, z: Double) { self.x = x; self.y = y; self.z = z }
    public init(_ a: [Double]) { self.init(x: a[0], y: a[1], z: a[2]) }

    public static let zero = Vec3(x: 0.0, y: 0.0, z: 0.0)

    public func dot(_ o: Vec3) -> Double { x * o.x + y * o.y + z * o.z }
    public func cross(_ o: Vec3) -> Vec3 { Vec3(x: y * o.z - z * o.y, y: z * o.x - x * o.z, z: x * o.y - y * o.x) }
    public var magnitude: Double { sqrt(max(0.0, dot(self))) }
    public func scaled(_ s: Double) -> Vec3 { Vec3(x: x * s, y: y * s, z: z * s) }
    public func plus(_ o: Vec3) -> Vec3 { Vec3(x: x + o.x, y: y + o.y, z: z + o.z) }
    public func minus(_ o: Vec3) -> Vec3 { Vec3(x: x - o.x, y: y - o.y, z: z - o.z) }
    public func normalized() -> Vec3 {
        let m = sqrt(max(1e-12, dot(self)))
        return Vec3(x: x / m, y: y / m, z: z / m)
    }
    /// Removes the component along unit vector `axis`.
    public func rejecting(_ axis: Vec3) -> Vec3 { minus(axis.scaled(dot(axis))) }
}

/// First-order low-pass gain for step dt and time constant tau.
@inline(__always) public func lowPassAlpha(dt: Double, tau: Double) -> Double { 1.0 - exp(-dt / tau) }

/// Great-circle distance in metres (mean Earth radius), portable replacement for CLLocation.distance.
public func haversineM(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
    let p1 = lat1 * .pi / 180.0, p2 = lat2 * .pi / 180.0
    let dp = p2 - p1, dl = (lon2 - lon1) * .pi / 180.0
    let h = pow(sin(dp / 2), 2) + cos(p1) * cos(p2) * pow(sin(dl / 2), 2)
    return 2.0 * 6371008.8 * asin(min(1.0, sqrt(h)))
}
