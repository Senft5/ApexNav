import Foundation
import XCTest
@testable import ApexKit

/// Replays Tests/Fixtures/car_glide.json (tools/make_glide_fixture.js, from web/car_glide.js) through CarGlide: the native
/// car map must draw the car where the web car map does (REVIEW_FEEL.md F-01).
final class CarGlideTests: XCTestCase {
    static let fixture: [String: Any] = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Fixtures/car_glide.json")
        let data = try! Data(contentsOf: url)
        return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    }()

    static func num(_ v: Any?) -> Double? { v is NSNull ? nil : (v as? NSNumber)?.doubleValue }

    func testMatchesTheWebGlide() {
        let events = Self.fixture["events"] as! [[String: Any]]
        let poses = (Self.fixture["poses"] as! [[Any]])
        var g = CarGlide()
        var k = 0
        for e in events {
            if let route = e["route"] as? [[Any]] {
                g.setRoute(route.map { (lat: Self.num($0[0])!, lon: Self.num($0[1])!) }, now: Self.num(e["now"])!)
            } else if let f = e["fix"] as? [Any] {
                g.push(lat: Self.num(f[0])!, lon: Self.num(f[1])!, course: Self.num(f[2]), mps: Self.num(f[3]), t: Self.num(f[4])!, now: Self.num(f[5])!)
            } else if let q = Self.num(e["query"]) {
                let want = poses[k]; k += 1
                guard let p = g.pose(at: q) else { return XCTFail("no pose at \(q)") }
                XCTAssertEqual(p.lat, Self.num(want[1])!, accuracy: 1e-9, "lat at \(q)")
                XCTAssertEqual(p.lon, Self.num(want[2])!, accuracy: 1e-9, "lon at \(q)")
                if let c = Self.num(want[3]) {
                    XCTAssertNotNil(p.course, "course at \(q)")
                    XCTAssertEqual(abs(CarGlide.turn(p.course ?? .nan, c)), 0, accuracy: 1e-6, "course at \(q)")
                } else { XCTAssertNil(p.course, "course at \(q)") }
                if let s = Self.num(want[4]) { XCTAssertEqual(p.s ?? .nan, s, accuracy: 1e-6, "s at \(q)") } else { XCTAssertNil(p.s, "s at \(q)") }
                XCTAssertEqual(g.moving(at: q), (want[5] as! NSNumber).intValue == 1, "moving at \(q)")
            }
        }
        XCTAssertEqual(k, poses.count)
    }

    /// At 22 m/s along a curve, the drawn car between two fixes stays on the road and within a metre of the true car: the
    /// web car map trailed it by 11 m at the median before dead reckoning.
    func testPredictsAlongTheRouteBetweenFixes() {
        var route: [(lat: Double, lon: Double)] = []
        var lat = 35.0, lon = -84.0, h = 0.0
        for _ in 0..<300 { h += 1.5; lat += 5 * cos(h * .pi / 180) / 110540; lon += 5 * sin(h * .pi / 180) / (111320 * cos(lat * .pi / 180)); route.append((lat, lon)) }
        var g = CarGlide()
        g.setRoute(route, now: 0)
        let v = 22.0
        // the true car is at route vertex k at s = 5 k; fixes at 1 s
        func truth(_ s: Double) -> (lat: Double, lon: Double) { let k = Int(s / 5); let f = s / 5 - Double(k); return (route[k].lat + (route[k + 1].lat - route[k].lat) * f, route[k].lon + (route[k + 1].lon - route[k].lon) * f) }
        var worst = 0.0
        for sec in 0..<10 {
            let s0 = 50 + v * Double(sec), p = truth(s0)
            g.push(lat: p.lat, lon: p.lon, course: nil, mps: v, t: Double(sec), now: Double(sec))
            for tenth in 1..<10 {
                let t = Double(sec) + Double(tenth) / 10, want = truth(s0 + v * Double(tenth) / 10)
                let got = g.pose(at: t)!
                if sec >= 2 { worst = max(worst, CarGlide.metres(got.lat, got.lon, want.lat, want.lon)) }
            }
        }
        XCTAssertLessThan(worst, 1.0)
        XCTAssertTrue(g.onRoute)
    }

    /// Never more than 1.5 s or 50 m past the fix, however late the next one is.
    func testCapsThePrediction() {
        var g = CarGlide()
        g.push(lat: 35, lon: -84, course: 90, mps: 30, t: 0, now: 0)
        let at2 = g.pose(at: 2)!, at10 = g.pose(at: 10)!
        XCTAssertEqual(CarGlide.metres(35, -84, at2.lat, at2.lon), 45, accuracy: 0.01)
        XCTAssertEqual(at2.lat, at10.lat); XCTAssertEqual(at2.lon, at10.lon)
        XCTAssertFalse(g.moving(at: 10))
        var fast = CarGlide()
        fast.push(lat: 35, lon: -84, course: 0, mps: 60, t: 0, now: 0)
        let p = fast.pose(at: 1.5)!
        XCTAssertEqual(CarGlide.metres(35, -84, p.lat, p.lon), CarGlide.capM, accuracy: 0.01)
    }

    /// A standing car is not predicted, and a new fix is eased into rather than jumped to.
    func testStandsStillAndEasesIntoTheNextFix() {
        var g = CarGlide()
        g.push(lat: 35, lon: -84, course: 0, mps: 0, t: 0, now: 0)
        XCTAssertEqual(g.pose(at: 1)!.lat, 35)
        g.push(lat: 35 + 4 / 110540, lon: -84, course: 0, mps: 0, t: 1, now: 1)
        let start = g.pose(at: 1)!, later = g.pose(at: 6)!
        XCTAssertEqual(start.lat, 35, accuracy: 1e-9)                     // drawn where it was, then eased
        XCTAssertEqual(later.lat, 35 + 4 / 110540, accuracy: 1e-8)
        g.push(lat: 36, lon: -84, course: 0, mps: 0, t: 4, now: 4)        // far away: drawn at once
        XCTAssertEqual(g.pose(at: 4)!.lat, 36)
    }
}
