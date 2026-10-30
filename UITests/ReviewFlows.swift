import XCTest

/// The review recording (.github/workflows/app-review.yml; docs/REVIEW_RECORDING.md): every real-world flow on the phone, and
/// on the car's screen when the CarPlay window is open, photographed step by step while simctl records video. Debug builds
/// only: APEX_REPLAY plays the bundled real drive (dry_ridge) through the shell's sensor handlers, APEX_REVIEW logs every
/// line said (the transcript), APEX_REVIEW_ROUTE hands the page that road as a GPX for guided drives, and APEX_REVIEW_SESSION
/// (a review account, from a repository secret) signs in. Skipped in normal test runs: only with APEX_REVIEW=1.
final class ReviewFlows: XCTestCase {
    private let carHome = XCUIApplication(bundleIdentifier: "com.apple.CarPlayApp")
    private let car = XCUIApplication(bundleIdentifier: "com.apple.CarPlayTemplateUIHost")
    private var app: XCUIApplication!
    private var web: XCUIElement!
    private var flow = "", step = 0

    override func setUp() {
        continueAfterFailure = true
        addUIInterruptionMonitor(withDescription: "Permissions") { alert in
            for label in ["Allow While Using App", "Allow Once", "Allow", "OK", "Continue", "Always Allow"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
    }

    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private func pause(_ s: Double) { RunLoop.current.run(until: Date().addingTimeInterval(s)) }

    /// A named step: the phone's screen, and the car's when there is one, kept with the run as "flow-NN-step".
    private func shot(_ name: String) {
        step += 1
        let tag = String(format: "%@-%02d-%@", flow, step, name)
        let p = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); p.name = "phone-\(tag)"; p.lifetime = .keepAlways; add(p)
        if XCUIScreen.screens.count > 1 {
            let c = XCTAttachment(screenshot: XCUIScreen.screens[1].screenshot()); c.name = "car-\(tag)"; c.lifetime = .keepAlways; add(c)
        }
    }

    private func start(_ name: String, route: Bool = false) {
        flow = name; step = 0
        app = XCUIApplication()
        var e = ["APEX_REPLAY": "dry_ridge", "APEX_REVIEW": "1"]
        if route { e["APEX_REVIEW_ROUTE"] = "1" }
        if let s = env["APEX_REVIEW_SESSION"], !s.isEmpty { e["APEX_REVIEW_SESSION"] = s }
        app.launchEnvironment = e
        app.launch()
        app.tap()
        web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 60))
        pause(5)
    }

    /// The first element with any of these labels (buttons, links, text), or nil.
    private func find(_ labels: [String], wait: Double = 8) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(wait)
        repeat {
            for l in labels {
                let e = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", l)).firstMatch
                if e.exists && e.isHittable { return e }
            }
            pause(0.5)
        } while Date() < deadline
        return nil
    }
    @discardableResult private func tap(_ labels: String..., wait: Double = 8) -> Bool {
        guard let e = find(labels, wait: wait) else { return false }
        e.tap(); pause(1.5); return true
    }
    private func tab(_ name: String) { _ = tap(name, wait: 6); pause(2) }
    private func scroll(_ times: Int, _ tag: String) {
        for k in 0..<times { app.swipeUp(velocity: .slow); pause(1); shot("\(tag)-\(k + 1)") }
        for _ in 0..<times { app.swipeDown(velocity: .fast) }
    }
    /// Vetta on the car's screen, when the CarPlay window is open.
    private func openInCar() {
        guard XCUIScreen.screens.count > 1 else { return }
        let icon = carHome.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Vetta")).firstMatch
        if icon.waitForExistence(timeout: 120) { icon.tap(); pause(8) }
    }
    /// Drive along the replayed road for `seconds`, a phone and car photo every `every` seconds.
    private func driveFor(_ seconds: Double, every: Double = 10, _ tag: String = "driving") {
        var t = 0.0
        while t < seconds { pause(every); t += every; shot(tag) }
    }
    private func startDrive() {
        tap("Drive it", "Start drive", "Start", wait: 20)
        if tap("Allow and start", wait: 5) { app.tap() }
        pause(4)
        shot("drive-started")
    }
    private func endDrive() {
        tap("End drive", wait: 10)
        pause(5)
        shot("drive-ended")
    }
    private func theme(_ name: String, night: Bool) {
        tab("Garage")
        for _ in 0..<6 where find([name], wait: 1) == nil { app.swipeUp(velocity: .slow); pause(0.8) }
        tap(name, wait: 4)
        shot("theme-\(name.lowercased())")
        if night { tap("Night", wait: 4); shot("night") }
        tab("Map")
    }

    func test01FirstRun() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("first-run")
        shot("opening")
        for k in 0..<5 {
            if tap("Get started", wait: 2) { break }
            if !tap("Next", "Start", wait: 2) { break }
            shot("onboarding-\(k + 1)")
        }
        shot("idle-map")
        tap("Layers", "Map layers", wait: 4); shot("layers"); app.tap()
    }

    func test02Tabs() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("tabs")
        shot("map")
        tab("Log"); shot("log"); scroll(3, "log")
        if let first = find(["Dry Ridge Rd"], wait: 6) { first.tap(); pause(4); shot("drive-detail"); scroll(4, "drive-detail") }
        tap("Replay", wait: 4); pause(6); shot("replay"); pause(10); shot("replay-later")
        tab("Map")
        tab("Crew"); shot("crew"); scroll(3, "crew")
        tab("Garage"); shot("garage"); scroll(8, "garage")
        tab("Map")
    }

    func test03Planning() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("planning")
        let search = web.searchFields.firstMatch
        if search.waitForExistence(timeout: 10) {
            search.tap(); pause(2); shot("where-to")
            search.typeText("Winton Woods"); pause(6); shot("suggestions")
            if let place = find(["Winton Woods"], wait: 6) { place.tap(); pause(25); shot("route-card"); scroll(3, "route-card") }
            tap("Save", wait: 4); shot("saved")
            tap("Close route", "Clear route", "×", wait: 4)
        }
        let again = web.searchFields.firstMatch
        if again.exists { again.tap(); pause(2) }
        shot("plan-sheet")
        if tap("Find a loop", wait: 6) { pause(30); shot("loop"); scroll(2, "loop") }
    }

    func test04GuidedDrive() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("guided-drive", route: true)
        openInCar()
        pause(20)                                                  // the GPX route builds
        shot("route-from-gpx")
        startDrive()
        driveFor(120, every: 10)
        if tap("Report a hazard", "Report", wait: 4) { shot("report-sheet"); tap("Gravel", "Pothole", wait: 4); shot("reported") }
        driveFor(60, every: 10)
        // the Live Activity in the Dynamic Island, from the home screen
        XCUIDevice.shared.press(.home); pause(4); shot("home-live-activity"); pause(6); shot("home-live-activity-later")
        app.activate(); pause(4); shot("back-in-app")
        XCUIDevice.shared.orientation = .landscapeLeft; pause(4); driveFor(40, every: 10, "landscape")
        XCUIDevice.shared.orientation = .portrait; pause(3)
        driveFor(120, every: 10)
        endDrive()
        tap("Open in the Log", wait: 6); pause(5); shot("in-the-log"); scroll(4, "in-the-log")
    }

    func test05FreeDrive() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("free-drive")
        openInCar()
        shot("idle")
        startDrive()
        driveFor(180, every: 10)
        endDrive()
        tap("Done", wait: 4); shot("after")
    }

    func test06TapedeckNight() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("tapedeck-night", route: true)
        theme("Tapedeck", night: true)
        pause(15)
        startDrive()
        driveFor(120, every: 10)
        endDrive()
    }

    func test07Billet() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("billet", route: true)
        theme("Billet", night: false)
        pause(15)
        startDrive()
        driveFor(90, every: 10)
        endDrive()
    }

    /// Signed in as the review account (APEX_REVIEW_SESSION): the account, crew page, friends and a convoy.
    func test08SignedIn() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        try XCTSkipIf((env["APEX_REVIEW_SESSION"] ?? "").isEmpty, "needs the review account (REVIEW_SESSION secret)")
        start("signed-in")
        tab("Crew"); pause(4); shot("crew"); scroll(5, "crew")
        tap("Friends", wait: 4); shot("friends"); app.tap()
        tab("Garage"); shot("account"); scroll(6, "account")
        tab("Map")
    }
}
