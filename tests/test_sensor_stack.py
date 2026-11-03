"""Panel round 2 NA-2: the drive sensor stack runs only while driving (core/live_pipeline.py SensorStack, the spec of
ApexKit.SensorStack), and the iOS shell starts and stops CoreMotion, the barometer and fine GPS with it."""
import os
import re

from core.live_pipeline import SensorStack

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


def test_idle_until_a_drive_starts():
    s = SensorStack()
    assert s.update(False, False, 0, 0) is False and not s.full and not s.imu_live(0)
    assert s.update(True, False, 0, 10) is True and s.full
    assert not s.imu_live(11) and s.imu_live(13)        # settling after the start, then live


def test_the_car_or_road_speed_promotes_it():
    car = SensorStack()
    assert car.update(False, True, None, 0) is True
    fast = SensorStack()
    assert fast.update(False, False, 7.9, 0) is False and fast.update(False, False, 8.0, 1) is True


def test_demoted_only_after_five_minutes_stopped():
    s = SensorStack()
    s.update(True, False, 20, 0)
    assert s.update(False, False, 0, 100) is False      # End: still on while stopped
    assert s.update(False, False, 5, 200) is False      # rolling again resets the wait
    assert s.update(False, False, 0, 300) is False and s.update(False, False, 0, 599) is False
    assert s.update(False, False, 0, 600) is True and not s.full
    assert s.update(False, False, None, 700) is False


def test_never_demoted_while_driving_or_in_the_car():
    s = SensorStack()
    s.update(True, False, 0, 0)
    assert s.update(True, False, 0, 10_000) is False and s.update(False, True, 0, 20_000) is False and s.full


def test_swift_matches_the_spec():
    swift = _read("ApexKit", "Sources", "ApexKit", "SensorStack.swift")
    for name, py in (("atSpeedMps", SensorStack.AT_SPEED_MPS), ("stoppedMps", SensorStack.STOPPED_MPS),
                     ("demoteAfterS", SensorStack.DEMOTE_AFTER_S), ("settleS", SensorStack.SETTLE_S)):
        m = re.search(rf"static let {name} = ([0-9.]+)", swift)
        assert m and float(m.group(1)) == py, name
    tests = _read("ApexKit", "Tests", "ApexKitTests", "SensorStackTests.swift")
    assert "speedMps: 7.9" in tests and "t: 600" in tests


def test_the_shell_runs_the_stack_only_while_driving():
    app = _read("ApexNavApp.swift")
    init = app[app.index("    override init() {"):app.index("    // MARK: Web bridge")]
    # no 100 Hz IMU, barometer or navigation-grade GPS at launch: the idle configuration, then the stack decides
    assert "startMotionPipeline()" not in init and "kCLLocationAccuracyBestForNavigation" not in init
    assert "updateSensorStack()" in init
    apply = app[app.index("    private func applySensorStack() {"):]
    apply = apply[:apply.index("\n    }\n") + 6]
    assert "kCLLocationAccuracyBestForNavigation" in apply and "kCLLocationAccuracyHundredMeters" in apply
    assert "startMotionPipeline()" in apply and "stopMotionPipeline()" in apply
    assert "locManager.showsBackgroundLocationIndicator = driving" in apply
    # promoted at Start (the page's Live Activity start), recording, the car, or road speed
    assert 'a == "start" || a == "end" { pageDriving = a == "start"; updateSensorStack() }' in app
    assert "defer { updateSensorStack() }" in app[app.index("    func handleJournal("):][:200]
    for hook in ("        isRecording = true\n        updateSensorStack()", "        isRecording = false\n        updateSensorStack()",
                 "        inCar = now\n        updateSensorStack()", "courseDeg = fix.courseDeg }\n        updateSensorStack()"):
        assert hook in app, hook
    upd = app[app.index("    private func updateSensorStack() {"):]
    assert "stack.update(driving: pageDriving || isRecording || journal != nil, inCar: inCar, speedMps: hasFix ? speedMps : nil" in upd[:600]
    # the thermal guard restarts motion only while the stack is on; IMU values are unknown while idle or settling
    thermal = app[app.index("    private func thermalChanged() {"):app.index("    private var imuLive: Bool")]
    assert "} else if stack.full {" in thermal
    assert "return thermal.imuLive(t: t) && (replaying || stack.imuLive(t: t))" in app
    assert "(s.stack?.imuLive(t: t) ?? true)" in app                     # no pothole spikes while settling
    # an idle map: one frame a second; the stack checked each second (a parked phone gets few fixes)
    assert "if !self.stack.full && !self.replaying && !second { return }" in app
    # idle frames say so ("idle"), never "paused", which the page reads as a hot phone
    assert app.count('live ? pipeline.mount.state.rawValue : idleCalibration') == 2
