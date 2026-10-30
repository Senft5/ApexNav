import XCTest

/// The review recording (.github/workflows/app-review.yml; docs/REVIEW_RECORDING.md): every real-world flow on the phone, and
/// on the car's screen when the CarPlay window is open, photographed step by step while simctl records video. Debug builds
/// only: APEX_REPLAY plays the bundled real drive (dry_ridge) through the shell's sensor handlers (APEX_REPLAY_FROM starts it
/// that many km along), APEX_REVIEW logs every line said (the transcript), APEX_REVIEW_ROUTE hands the page that road as a
/// GPX for guided drives, and APEX_REVIEW_SESSION (a review account, from a repository secret) signs in. Skipped in normal
/// test runs: only with APEX_REVIEW=1.
final class ReviewFlows: XCTestCase {
    private let carHome = XCUIApplication(bundleIdentifier: "com.apple.CarPlayApp")
    private let car = XCUIApplication(bundleIdentifier: "com.apple.CarPlayTemplateUIHost")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private var app: XCUIApplication!
    private var web: XCUIElement!
    private var flow = "", step = 0

    /// REVIEW4 §6.1: where the replay starts, in km along the bundled drive. The drive's first 21 km are Colerain Avenue and
    /// I-275; its corners run from the exit ramp at 21.4 km to 34.1 km on Dry Ridge Rd. TWISTIES is a mile before the first.
    private static let TWISTIES = 19.8

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
    /// Waits up to `s` seconds for `cond`; true when it held.
    private func until(_ s: Double, _ cond: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(s)
        while Date() < deadline { if cond() { return true }; pause(0.5) }
        return cond()
    }

    /// A named step: the phone's screen, and the car's when there is one, kept with the run as "flow-NN-step".
    private func shot(_ name: String) {
        step += 1
        let tag = String(format: "%@-%03d-%@", flow, step, name)
        let p = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); p.name = "phone-\(tag)"; p.lifetime = .keepAlways; add(p)
        if XCUIScreen.screens.count > 1 {
            let c = XCTAttachment(screenshot: XCUIScreen.screens[1].screenshot()); c.name = "car-\(tag)"; c.lifetime = .keepAlways; add(c)
        }
    }

    /// `from`: km along the replayed drive to start at (APEX_REPLAY_FROM); nil for its real start. `tapFirst`: a tap after
    /// launch wakes the permission monitor; the first run photographs the opening before anything is touched (§6.9).
    private func start(_ name: String, route: Bool = false, from: Double? = nil, tapFirst: Bool = true) {
        flow = name; step = 0
        app = XCUIApplication()
        var e = ["APEX_REPLAY": "dry_ridge", "APEX_REVIEW": "1"]
        if route { e["APEX_REVIEW_ROUTE"] = "1" }
        if let from { e["APEX_REPLAY_FROM"] = String(format: "%.2f", from) }
        if let s = env["APEX_REVIEW_SESSION"], !s.isEmpty { e["APEX_REVIEW_SESSION"] = s }
        app.launchEnvironment = e
        app.launch()
        if tapFirst { app.tap() }
        web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 60))
        if tapFirst {
            pause(5)
            // the welcome runs in the app since U-65: every flow but first-run goes past it (its one key is "Start")
            let welcome = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Welcome to Vetta")).firstMatch
            if welcome.waitForExistence(timeout: 8) {
                let go = welcome.buttons["Start"]
                if go.exists { go.tap(); pause(2) }
            }
            allowLocation()
        }
    }

    /// The system's location sheet, answered: it follows the welcome's Start (U-65), and `simctl privacy grant` before the
    /// app is installed doesn't hold, so the second recording's drives sat behind it and never moved.
    private func allowLocation(wait: Double = 6) {
        let sheet = springboard.alerts.firstMatch
        guard sheet.waitForExistence(timeout: wait) else { return }
        for label in ["Allow While Using App", "Allow Once", "Allow"] where sheet.buttons[label].exists {
            sheet.buttons[label].tap(); pause(1.5); return
        }
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
    /// The first button whose label starts with `prefix` (a row whose label carries more than its name), or nil.
    private func findButton(startingWith prefix: String, wait: Double = 8) -> XCUIElement? {
        let e = web.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", prefix)).firstMatch
        return until(wait, { e.exists && e.isHittable }) ? e : nil
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

    // MARK: The car

    private func inCar(_ label: String) -> XCUIElement {
        car.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }
    /// Vetta on the car's screen, when the CarPlay window is open.
    private func openInCar() {
        guard XCUIScreen.screens.count > 1 else { return }
        let icon = carHome.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Vetta")).firstMatch
        if icon.waitForExistence(timeout: 120) { icon.tap(); pause(8) }
    }
    /// What the car's screen says in words (its maneuver, the bars, an alert), without the numbers that change every second:
    /// when this changes, the guidance key changed. One accessibility snapshot, so it is cheap enough to read every second.
    private func carWords() -> String {
        guard XCUIScreen.screens.count > 1, let root = try? car.snapshot() else { return "" }
        var out: [String] = []
        func walk(_ e: XCUIElementSnapshot) {
            if e.elementType == .staticText, !e.label.isEmpty, e.label.range(of: "[0-9]", options: .regularExpression) == nil { out.append(e.label) }
            e.children.forEach(walk)
        }
        walk(root)
        return out.joined(separator: "|")
    }

    // MARK: Driving

    /// Drive along the replayed road for `seconds`: a phone and car photo every `every` seconds, and one more a second after
    /// the car's guidance changes (REVIEW4 §6.8), so every new maneuver card is in the pack, not only every tenth second.
    private func driveFor(_ seconds: Double, every: Double = 3, _ tag: String = "driving") {
        let end = Date().addingTimeInterval(seconds)
        var next = Date().addingTimeInterval(every), words = carWords()
        while Date() < end {
            pause(1)
            let now = carWords()
            if !now.isEmpty, now != words {
                words = now; pause(1); shot("car-guide"); next = Date().addingTimeInterval(every)
            } else if Date() >= next {
                shot(tag); next = Date().addingTimeInterval(every)
            }
        }
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
    /// A theme from its card in the Garage: the card's "Use" key (U-69: named "Use <theme>" for exactly this), then wait
    /// until the theme took, which the Use key coming back on Roadbook's card shows (REVIEW4 §6.2).
    private func theme(_ name: String, night: Bool) {
        tab("Garage")
        let use = "Use \(name)"
        for _ in 0..<8 where find([use], wait: 1) == nil { app.swipeUp(velocity: .slow); pause(0.8) }
        if let key = find([use], wait: 4) { key.tap() } else { find(["Try \(name)"], wait: 2)?.tap() }
        let back = web.buttons["Use Roadbook"], gone = web.buttons[use]
        XCTAssertTrue(until(10) { back.exists && !gone.exists }, "\(name) did not take (Roadbook's card has no Use key)")
        pause(1.5)
        shot("theme-\(name.lowercased())")
        if night { tap("Night", wait: 4); shot("night") }
        tab("Map")
    }
    /// The drive just ended, in the Log: its page and its Replay in the current theme.
    private func driveInLog(scrolls: Int, replay: Bool) {
        guard tap("Open in the Log", wait: 6) else { return }
        pause(5); shot("in-the-log"); scroll(scrolls, "in-the-log")
        if replay, tap("Replay", wait: 4) { pause(6); shot("replay"); pause(10); shot("replay-later") }
    }

    // MARK: The flows

    func test01FirstRun() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        // REVIEW4 §6.9: the opening before anything is touched (the welcome, U-65), then its Start, then the location sheet
        // (the workflow grants nothing for this flow, so the system asks as it would on a new phone)
        start("first-run", tapFirst: false)
        pause(1.5); shot("opening")
        pause(3); shot("opening-later")                            // the welcome's strip cycles its calls
        for k in 0..<5 {
            if tap("Get started", "Start", wait: 2) { break }
            if !tap("Next", wait: 2) { break }
            shot("onboarding-\(k + 1)")
        }
        let sheet = springboard.alerts.firstMatch
        if sheet.waitForExistence(timeout: 8) {
            shot("location-permission")
            for label in ["Allow While Using App", "Allow Once", "Allow"] where sheet.buttons[label].exists { sheet.buttons[label].tap(); break }
            pause(2)
        }
        pause(3); shot("idle-map")
        tap("Layers", "Map layers", wait: 4); shot("layers"); tap("Close", "Done", wait: 2)
    }

    func test02Tabs() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        // REVIEW4 §6.4: a short drive on the corners first, so the Log, the drive's page and its Replay have something to show
        start("tabs", from: Self.TWISTIES + 3.5)
        shot("map")
        startDrive()
        driveFor(120, every: 10)
        endDrive()
        driveInLog(scrolls: 4, replay: true)
        tab("Map")
        tab("Log"); shot("log"); scroll(3, "log")
        tab("Map")
        tab("Crew"); shot("crew"); scroll(3, "crew")
        tab("Garage"); shot("garage"); scroll(8, "garage")
        // Roadbook at night (§6.2): the Garage's Night detent, then the map
        tab("Garage")
        for _ in 0..<8 where find(["Night"], wait: 1) == nil { app.swipeUp(velocity: .slow); pause(0.8) }
        if tap("Night", wait: 4) { tab("Map"); pause(3); shot("roadbook-night") }
    }

    func test03Planning() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("planning")
        let search = web.searchFields.firstMatch
        if search.waitForExistence(timeout: 10) {
            search.tap(); pause(2); shot("where-to")
            search.typeText("Winton Woods"); pause(6); shot("suggestions")
            // REVIEW4 §6.3: the place row (a button whose label carries the address), never the search field's own text;
            // then wait for the route to resolve, which puts the route bar and its Start up
            if let place = findButton(startingWith: "Winton Woods", wait: 8) {
                place.tap()
                let bar = web.buttons["Route details"], go = web.buttons["Start drive"]
                XCTAssertTrue(until(45) { (bar.exists && bar.isHittable) || (go.exists && go.isHittable) }, "the route to Winton Woods never resolved")
                pause(3); shot("route")
                if bar.exists && bar.isHittable { bar.tap(); pause(2) }
                shot("route-card"); scroll(3, "route-card")
                app.swipeUp(velocity: .fast); pause(1.5); shot("route-card-open")      // the card dragged all the way up
                app.swipeDown(velocity: .fast); pause(1)
            }
            tap("Save", wait: 4); shot("saved")
            tap("Close route", "Clear route", "×", wait: 4)
        }
        let again = web.searchFields.firstMatch
        if again.exists { again.tap(); pause(2) }
        shot("plan-sheet")
        // the plan sheet's More (§6.3)
        let more = web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "More:")).firstMatch
        if until(4, { more.exists && more.isHittable }) {
            more.tap(); pause(1.5); shot("plan-more"); scroll(2, "plan-more")
            more.tap(); pause(1)
        }
        if tap("Find a loop", wait: 6) { pause(30); shot("loop"); scroll(2, "loop") }
    }

    func test04GuidedDrive() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        // REVIEW4 §6.1: a mile before the corners (the GPX route starts there too), a photo every 3 s through them
        start("guided-drive", route: true, from: Self.TWISTIES)
        openInCar()
        pause(20)                                                  // the GPX route builds
        shot("route-from-gpx")
        startDrive()
        driveFor(60, every: 10, "interstate")                      // the last mile of I-275, then the exit
        driveFor(240)                                              // the ramp, the junction and the first corners
        if tap("Report a hazard", "Report", wait: 4) {
            shot("report-sheet"); tap("Gravel", "Pothole", wait: 4)
            pause(1); shot("reported")                             // the car's pin and alert a second after (§6.8)
        }
        driveFor(60)
        // the Live Activity in the Dynamic Island, from the home screen, and expanded by a long press (§6.7)
        XCUIDevice.shared.press(.home); pause(4); shot("home-live-activity")
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0)).withOffset(CGVector(dx: 0, dy: 30)).press(forDuration: 1.2)
        pause(2); shot("island-expanded")
        XCUIDevice.shared.press(.home); pause(4); shot("home-live-activity-later")
        app.activate(); pause(4); shot("back-in-app")
        XCUIDevice.shared.orientation = .landscapeLeft; pause(4); driveFor(40, every: 5, "landscape")
        XCUIDevice.shared.orientation = .portrait; pause(3)
        driveFor(660)                                              // Dry Ridge Rd's corners, to the last at 34.1 km
        endDrive()
        driveInLog(scrolls: 4, replay: false)
    }

    func test05FreeDrive() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        // from the drive's real start, so the interstate join is seen; started and ended from the car when it can (§6.8)
        start("free-drive")
        openInCar()
        shot("idle")
        let carDrive = inCar("Drive")
        if XCUIScreen.screens.count > 1, carDrive.waitForExistence(timeout: 5) {
            carDrive.tap(); pause(5); shot("drive-started-from-car")
        } else {
            startDrive()
        }
        driveFor(180, every: 10)
        let carEnd = inCar("End")
        if XCUIScreen.screens.count > 1, carEnd.waitForExistence(timeout: 3) {
            carEnd.tap(); pause(5); shot("drive-ended-from-car")
        } else {
            endDrive()
        }
        tap("Done", wait: 4); pause(3); shot("after")
    }

    func test06TapedeckNight() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("tapedeck-night", route: true, from: Self.TWISTIES)
        theme("Tapedeck", night: true)
        pause(15)
        startDrive()
        driveFor(60, every: 10, "interstate")
        driveFor(300)
        endDrive()
        driveInLog(scrolls: 1, replay: true)
    }

    func test07Billet() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("billet", route: true, from: Self.TWISTIES)
        theme("Billet", night: false)
        pause(15)
        startDrive()
        driveFor(60, every: 10, "interstate")
        driveFor(300)
        endDrive()
        driveInLog(scrolls: 1, replay: true)
    }

    /// Signed in as the review account (APEX_REVIEW_SESSION): the member's Crew page, Friends and the account in the Garage.
    func test08SignedIn() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        try XCTSkipIf((env["APEX_REVIEW_SESSION"] ?? "").isEmpty, "needs the review account (REVIEW_SESSION secret)")
        start("signed-in")
        tab("Crew")
        // REVIEW4 §6.5 (U-66): the member's page, not the sign-in page, before anything is photographed; nothing here may
        // tap into "Sign in with Google" (the last recording's stray tap opened Google's sheet)
        let signedOut = { self.find(["Sign in with Google", "Sign in with Apple"], wait: 0.5) != nil }
        let member = until(30) { !signedOut() }
        XCTAssertTrue(member, "Crew still shows the sign-in page: the review session did not sign in")
        pause(3); shot("crew")
        guard member else { return }
        scroll(5, "crew")
        if let friends = findButton(startingWith: "Friends", wait: 4) { friends.tap(); pause(2); shot("friends"); tap("Done", wait: 3) }
        tab("Garage"); shot("account"); scroll(6, "account")
        tab("Map")
    }
}
