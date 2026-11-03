import XCTest
@testable import ApexKit

// The same cases as tests/test_sensor_stack.py runs against core/live_pipeline.py SensorStack.
final class SensorStackTests: XCTestCase {
    func testIdleUntilADriveStarts() {
        var s = SensorStack()
        XCTAssertFalse(s.update(driving: false, inCar: false, speedMps: 0, t: 0))
        XCTAssertFalse(s.full, "an idle map runs no drive sensors")
        XCTAssertFalse(s.imuLive(t: 0))
        XCTAssertTrue(s.update(driving: true, inCar: false, speedMps: 0, t: 10))
        XCTAssertTrue(s.full)
        XCTAssertFalse(s.imuLive(t: 11), "settling after the start")
        XCTAssertTrue(s.imuLive(t: 13))
    }

    func testTheCarOrRoadSpeedPromotesIt() {
        var car = SensorStack()
        XCTAssertTrue(car.update(driving: false, inCar: true, speedMps: nil, t: 0))
        var fast = SensorStack()
        XCTAssertFalse(fast.update(driving: false, inCar: false, speedMps: 7.9, t: 0))
        XCTAssertTrue(fast.update(driving: false, inCar: false, speedMps: 8.0, t: 1))
    }

    func testDemotedOnlyAfterFiveMinutesStopped() {
        var s = SensorStack()
        _ = s.update(driving: true, inCar: false, speedMps: 20, t: 0)
        XCTAssertFalse(s.update(driving: false, inCar: false, speedMps: 0, t: 100), "End: the stack stays while stopped")
        XCTAssertFalse(s.update(driving: false, inCar: false, speedMps: 5, t: 200), "rolling again resets the wait")
        XCTAssertFalse(s.update(driving: false, inCar: false, speedMps: 0, t: 300))
        XCTAssertFalse(s.update(driving: false, inCar: false, speedMps: 0, t: 599))
        XCTAssertTrue(s.update(driving: false, inCar: false, speedMps: 0, t: 600))
        XCTAssertFalse(s.full)
        XCTAssertFalse(s.update(driving: false, inCar: false, speedMps: nil, t: 700))
    }

    func testNeverDemotedWhileDrivingOrInTheCar() {
        var s = SensorStack()
        _ = s.update(driving: true, inCar: false, speedMps: 0, t: 0)
        XCTAssertFalse(s.update(driving: true, inCar: false, speedMps: 0, t: 10_000))
        XCTAssertFalse(s.update(driving: false, inCar: true, speedMps: 0, t: 20_000))
        XCTAssertTrue(s.full)
    }
}
