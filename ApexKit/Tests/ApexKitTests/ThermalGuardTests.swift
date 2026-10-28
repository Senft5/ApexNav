import XCTest
@testable import ApexKit

final class ThermalGuardTests: XCTestCase {
    func testPausesOnlyWhenCritical() {
        var g = ThermalGuard()
        XCTAssertFalse(g.update(level: 1, t: 0))
        XCTAssertFalse(g.update(level: 2, t: 1))
        XCTAssertFalse(g.paused)
        XCTAssertTrue(g.update(level: 3, t: 2))
        XCTAssertTrue(g.paused)
        XCTAssertFalse(g.imuLive(t: 2))
    }

    func testSeriousKeepsItPausedAndFairResumes() {
        var g = ThermalGuard()
        _ = g.update(level: 3, t: 0)
        XCTAssertFalse(g.update(level: 2, t: 10), "serious is not cool enough to resume")
        XCTAssertTrue(g.paused)
        XCTAssertTrue(g.update(level: 1, t: 20))
        XCTAssertFalse(g.paused)
    }

    func testValuesStayUnknownWhileSettling() {
        var g = ThermalGuard()
        _ = g.update(level: 3, t: 0)
        _ = g.update(level: 0, t: 100)
        XCTAssertFalse(g.imuLive(t: 101))
        XCTAssertTrue(g.imuLive(t: 103))
        XCTAssertTrue(ThermalGuard().imuLive(t: 0), "a cool phone from launch is live at once")
    }
}
