import Foundation

/// Barometer gives the smooth relative shape, GPS anchors it to MSL.
/// Mirrors core/live_pipeline.ElevationFusion.
public struct ElevationFusion: Sendable {
    public var baroAvailable: Bool
    public var relativeBaroM = 0.0
    var baroOffsetM: Double?
    var gpsOnlyM: Double?

    public init(baroAvailable: Bool = true) { self.baroAvailable = baroAvailable }

    public mutating func ingestGPS(altitudeM: Double, verticalAccuracyM: Double) {
        guard verticalAccuracyM > 0 else { return }
        let anchor = altitudeM - relativeBaroM
        if let offset = baroOffsetM {
            let k = 0.02 * min(1.0, 8.0 / max(verticalAccuracyM, 1.0))
            baroOffsetM = offset + k * (anchor - offset)
        } else {
            baroOffsetM = anchor
        }
        if let prev = gpsOnlyM { gpsOnlyM = prev + 0.2 * (altitudeM - prev) } else { gpsOnlyM = altitudeM }
    }

    public var elevationM: Double? {
        if baroAvailable, let offset = baroOffsetM { return relativeBaroM + offset }
        return gpsOnlyM
    }
}

/// One 5.0 m arc-length road bin.
public struct RoadNode: Equatable, Sendable {
    public let lat: Double
    public let lon: Double
    public let elevationM: Double?
    public let gradePct: Double
    public let roughRMSMps2: Double
}

/// Emits a node every 5.0 m of arc length between fixes (interpolating position and
/// elevation), so 1 Hz GPS at speed still yields true 5 m bins. Mirrors core/live_pipeline.Odometer.
public struct Odometer5m: Sendable {
    var prevLat: Double?
    var prevLon: Double?
    var prevElev: Double?
    var sinceNodeM = 0.0
    var lastNodeElev: Double?
    public private(set) var gradePct = 0.0

    static let maxAccuracyM = 30.0
    static let jumpM = 250.0
    static let stationaryMps = 0.8

    public init() {}

    mutating func reset(lat: Double, lon: Double, elev: Double?) {
        prevLat = lat; prevLon = lon; prevElev = elev
        sinceNodeM = 0.0
        lastNodeElev = elev
    }

    public mutating func feed(lat: Double, lon: Double, elevationM elev: Double?, speedMps: Double,
                              horizontalAccuracyM: Double, roughRMSMps2: Double) -> [RoadNode] {
        guard horizontalAccuracyM <= Self.maxAccuracyM else { return [] }
        guard let pLat = prevLat, let pLon = prevLon else {
            reset(lat: lat, lon: lon, elev: elev)
            return []
        }
        let leg = haversineM(pLat, pLon, lat, lon)
        if leg > Self.jumpM {
            // GPS jump / resume after a gap: restart instead of painting a fake straight line
            reset(lat: lat, lon: lon, elev: elev)
            return []
        }
        if speedMps >= 0 && speedMps < Self.stationaryMps {
            prevLat = lat; prevLon = lon; prevElev = elev
            return []
        }
        var nodes: [RoadNode] = []
        var s = segmentLengthM - sinceNodeM
        while s <= leg && leg > 0 {
            let t = s / leg
            let nLat = pLat + (lat - pLat) * t
            let nLon = pLon + (lon - pLon) * t
            var nElev: Double?
            if let e0 = prevElev, let e1 = elev { nElev = e0 + (e1 - e0) * t } else { nElev = elev }
            if let e = nElev, let prev = lastNodeElev {
                let raw = max(-35.0, min(35.0, (e - prev) / segmentLengthM * 100.0))
                gradePct = 0.6 * gradePct + 0.4 * raw
            }
            lastNodeElev = nElev
            nodes.append(RoadNode(lat: nLat, lon: nLon, elevationM: nElev, gradePct: gradePct, roughRMSMps2: roughRMSMps2))
            s += segmentLengthM
        }
        sinceNodeM = leg - (s - segmentLengthM)
        prevLat = lat; prevLon = lon; prevElev = elev
        return nodes
    }
}
