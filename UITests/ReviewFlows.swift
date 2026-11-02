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
    private var drivingSince = Date()                              // when the drive started (startDrive), for driveTo
    private var portrait = CGRect.zero                              // the app's window upright, read once a flow (onScreen)

    /// Panel round 1 (D-3, R-4c, T-6): a step that didn't land stops its flow, red, instead of photographing the screen it
    /// was stuck on for the rest of the run (recording 6's tabs flow: seventeen photos of the replay).
    struct FlowStopped: Error, CustomStringConvertible { let description: String }
    private func stop(_ why: String) -> FlowStopped { XCTFail(why); return FlowStopped(description: why) }

    /// REVIEW4 §6.1: where the replay starts, in km along the bundled drive. The drive's first 21 km are Colerain Avenue and
    /// I-275; its corners run from the exit ramp at 21.4 km to 34.1 km on Dry Ridge Rd. TWISTIES is a mile before the first.
    private static let TWISTIES = 19.8
    /// REVIEW4_CHECK §4.7 (U-86): a standstill in a corner. The drive's R3- at 25.32 km starts at 25.29; the replay stands
    /// still at 25.31 (APEX_REPLAY_HOLD), inside it, for long enough that the strip's passed-note rule (3 s at 0 ft) shows.
    private static let STANDSTILL = (km: 25.31, s: 8.0)
    /// The welcome strip's beat (web/cockpit.js runOnboarding: a call every 1.8 s, five calls in OB_NOTES).
    private static let WELCOME_BEAT = 1.8
    /// REVIEW5 §7.5, §7.8: where the guided drive (from TWISTIES) says its lines, in minutes after Start, from the billet
    /// flow's transcript of the same road at real speed: "Tight right, careful" at 0.7, "Very sharp left, almost back on
    /// itself" at 1.7 (a corner call), "Quiet from here" at 2.6 and the next note at 3.8 (the quiet line between).
    private static let CORNER_CALL = 1.6, QUIET_LINE = 2.75

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

    /// `from`: km along the replayed drive to start at (APEX_REPLAY_FROM); nil for its real start. `hold`: a standstill of
    /// `s` seconds at `km` (APEX_REPLAY_HOLD). `tapFirst`: a tap after launch wakes the permission monitor; the first run
    /// photographs the opening before anything is touched (§6.9).
    private func start(_ name: String, route: Bool = false, from: Double? = nil, hold: (km: Double, s: Double)? = nil, tapFirst: Bool = true,
                       args: [String] = []) {
        flow = name; step = 0; portrait = .zero
        app = XCUIApplication()
        app.launchArguments += args
        var e = ["APEX_REPLAY": "dry_ridge", "APEX_REVIEW": "1"]
        if route { e["APEX_REVIEW_ROUTE"] = "1" }
        if let from { e["APEX_REPLAY_FROM"] = String(format: "%.2f", from) }
        if let hold { e["APEX_REPLAY_HOLD"] = String(format: "%.2f:%.0f", hold.km, hold.s) }
        if let s = env["APEX_REVIEW_SESSION"], !s.isEmpty { e["APEX_REVIEW_SESSION"] = s }
        if tapFirst { e["APEX_REVIEW_PAST_WELCOME"] = "1" }        // the welcome is first-run's to photograph
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

    /// The first element with any of these labels (buttons, links, text) that is on the screen, or nil.
    private func find(_ labels: [String], wait: Double = 8) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(wait)
        repeat {
            for l in labels { if let e = onScreen(l) { return e } }
            pause(0.5)
        } while Date() < deadline
        return nil
    }
    /// REVIEW5 §7.2: the page keeps keys it isn't showing (a closed sheet's Done) in its accessibility tree, and the first
    /// match for "Done" was one of those, so the replay's own Done was never tapped. Every match is looked at (at most 12),
    /// and the first one hittable with its centre on the screen is taken.
    /// Recording 6 (guided-drive): on its side in the middle of a drive the page's accessibility tree took over 30 s a query,
    /// and XCUITest ended the flow ("Failed to get matching snapshot: Timed out") 13 minutes before End. The window is read
    /// once a flow, upright (turned for landscape, never queried again), and the first match is tried before the rest.
    private func screenFrame() -> CGRect {
        if portrait.isEmpty { portrait = app.windows.firstMatch.frame }
        let f = portrait
        return XCUIDevice.shared.orientation.isLandscape ? CGRect(x: 0, y: 0, width: max(f.width, f.height), height: min(f.width, f.height)) : f
    }
    private func onScreen(_ label: String, below share: CGFloat = 0) -> XCUIElement? {
        let all = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label))
        let screen = screenFrame()
        for i in 0..<min(all.count, 12) {
            let e = all.element(boundBy: i)
            guard e.exists, e.isHittable else { continue }
            let f = e.frame, mid = CGPoint(x: f.midX, y: f.midY)
            if !f.isEmpty, screen.isEmpty || (screen.contains(mid) && mid.y >= screen.minY + screen.height * share) { return e }
        }
        return nil
    }
    /// The tab bar is up: its four tabs on the screen, in its bottom quarter, and no replay over them (its "Replay ·" chip and
    /// its Play key gone). The tabs flow's Log, People and Garage photos were all of the replay (REVIEW5 §7.2).
    private func tabBarShown() -> Bool {
        guard ["Map", "Log", "People", "Garage"].allSatisfy({ onScreen($0, below: 0.75) != nil }) else { return false }
        // the plate reads "Replay · <road> ×" while it plays and "Replay finished · <score> ×" after (U-110): either is the replay
        let chip = web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@ AND label ENDSWITH %@", "Replay", "×")).firstMatch
        return !chip.exists && onScreen("Play") == nil
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
    /// A tab, once the tab bar is up (REVIEW5 §7.2): a replay over it is closed by its Done first. Panel round 1 (D-3, T-6):
    /// no tab bar stops the flow; what a tab must show is checked by the step that needs it (theme() reads the Garage's cards).
    private func tab(_ name: String) throws {
        if !tabBarShown() { _ = replayDone() }
        guard until(6, tabBarShown) else { throw stop("the tab bar is not on screen for \(name)") }
        guard tap(name, wait: 6) else { throw stop("the \(name) tab was not on screen") }
        pause(2)
    }
    /// Up to `times` photos a swipe apart. REVIEW5 §7.3: a page that fits gave identical frames (planning 005 to 007,
    /// signed-in 002 to 011), so a swipe that changes nothing on the screen ends the scrolling, unphotographed.
    private func scroll(_ times: Int, _ tag: String) {
        var before = XCUIScreen.main.screenshot().pngRepresentation, moved = 0
        for k in 0..<times {
            app.swipeUp(velocity: .slow); pause(1)
            let now = XCUIScreen.main.screenshot().pngRepresentation
            if now == before { break }
            before = now; moved += 1
            shot("\(tag)-\(k + 1)")
        }
        for _ in 0..<moved { app.swipeDown(velocity: .fast) }
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
    /// Drive on until `minutes` after the drive started: the replay runs on the wall clock from Start, so a step placed by
    /// the drive's own time lands on the same stretch of road however long the photos before it took (REVIEW4_CHECK §4.6).
    private func driveTo(_ minutes: Double, every: Double = 3, _ tag: String = "driving") {
        let left = minutes * 60 - Date().timeIntervalSince(drivingSince)
        if left > 0 { driveFor(left, every: every, tag) }
    }
    private func startDrive() {
        tap("Drive it", "Start drive", "Start", wait: 20)
        if tap("Allow and start", wait: 5) { app.tap() }
        drivingSince = Date()
        pause(4)
        shot("drive-started")
    }
    /// The replay's own Done key. Recording 6 (D-3): its accessible name is "Done: close the replay" (web/index.html
    /// #replayDone), so the old exact matches on "Done" and "Close the replay" never found it, and the Replay chip they fell
    /// back on was not hittable: every tab step after it photographed the replay. It is found by its whole name, in one query.
    private func replayDone() -> Bool {
        let done = web.buttons.matching(NSPredicate(format: "label == %@", "Done: close the replay")).firstMatch
        if until(3, { done.exists && done.isHittable }) { done.tap(); pause(2); return true }
        let chip = web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@ AND label ENDSWITH %@", "Replay", "×")).firstMatch
        if chip.exists { chip.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap(); pause(2); return true }
        return false
    }
    /// The replay closed (REVIEW4_CHECK §4.4, U-104; panel round 1 D-3): its Done, then the tab bar back within 8 s, or the
    /// flow stops there, red, rather than photograph the replay under every tab's name.
    private func closeReplay() throws {
        XCTAssertTrue(replayDone(), "the replay's Done key was not on screen")
        guard until(8, tabBarShown) else { throw stop("the replay did not close (no tab bar after Done)") }
        shot("replay-closed")
    }
    /// End, and whether the drive ended: its end card's "Open in the Log" key came up. I-3: for 5 s after End the status row
    /// says so and End is Undo, the drive still live (photographed), then the card.
    @discardableResult private func endDrive() -> Bool {
        let end = web.buttons.matching(NSPredicate(format: "label == %@", "End drive")).firstMatch   // one query (recording 6)
        if until(10, { end.exists && end.isHittable }) { end.tap(); pause(1.5) }
        shot("drive-ending")                                   // I-3: the 5 s Undo window, the drive still live
        pause(5)
        shot("drive-ended")
        return find(["Open in the Log"], wait: 6) != nil
    }
    /// The phone on its side for `seconds`, a photo every `every` seconds, then upright again (REVIEW5 §7.5).
    private func landscape(_ seconds: Double, every: Double = 4, _ tag: String) {
        XCUIDevice.shared.orientation = .landscapeLeft; pause(3)
        driveFor(seconds, every: every, tag)
        XCUIDevice.shared.orientation = .portrait; pause(3)
    }
    /// The home screen with the drive behind it: the Dynamic Island's Live Activity (REVIEW5 §7.8), then back in the app.
    private func homeScreen(_ tag: String) {
        XCUIDevice.shared.press(.home); pause(4); shot(tag)
        app.activate(); pause(3)
    }
    /// REVIEW5 §7.9: the lock screen's Live Activity. XCUIDevice has no lock button in its public buttons and simctl has no
    /// lock command; XCUIDevice answers the private pressLockButton in the simulator, so it is asked first and the step is
    /// skipped (said in the log) when it doesn't. The home button wakes the locked screen, where the Live Activity sits.
    private func lockScreen(_ tag: String) {
        let lock = NSSelectorFromString("pressLockButton")
        guard XCUIDevice.shared.responds(to: lock) else { NSLog("APEX-REVIEW-TEST no lock button: lock screen step skipped"); return }
        _ = XCUIDevice.shared.perform(lock); pause(3)
        XCUIDevice.shared.press(.home); pause(3)               // wakes the screen: the lock screen with the Live Activity
        shot(tag)
        XCUIDevice.shared.press(.home); pause(2)               // the simulator has no passcode: home again unlocks
        app.activate(); pause(3)
    }
    /// A theme from its card in the Garage: the card's "Use" key (U-69: named "Use <theme>" for exactly this), then wait
    /// until the theme took, which the Use key coming back on Roadbook's card shows (REVIEW4 §6.2).
    /// Panel round 1 (T-6): recording 6's Billet flow was Roadbook in all 108 photos. The review route (APEX_REVIEW_ROUTE)
    /// resolved while the Garage was open, its card opened itself (U-70) and closed the Garage between finding "Use Billet"
    /// and tapping it, so the tap fell on the map and the flow drove on in Roadbook. Now a flow with a route waits for it
    /// first, the key is tapped up to twice, the step's photo is the Garage with the theme's card "In use", and a theme
    /// that didn't take stops the flow.
    private func theme(_ name: String, night: Bool, route: Bool = false) throws {
        if route {
            let bar = web.buttons["Route details"]                // the route bar is in the page only once routed
            XCTAssertTrue(until(60) { bar.exists }, "the review route never resolved")
            pause(3)                                               // its card has opened itself (U-70) by now
        }
        let use = "Use \(name)", back = web.buttons["Use Roadbook"], gone = web.buttons[use]
        let took = { back.exists && !gone.exists }
        for _ in 0..<2 where !took() {
            try tab("Garage")
            for _ in 0..<8 where find([use], wait: 1) == nil { app.swipeUp(velocity: .slow); pause(0.8) }
            if let key = find([use], wait: 4) { key.tap() } else { find(["Try \(name)"], wait: 2)?.tap() }
            _ = until(10, took)
        }
        guard took() else { throw stop("\(name) did not take (Roadbook's card has no Use key)") }
        pause(1.5)
        shot("theme-\(name.lowercased())")
        if night { tap("Night", wait: 4); shot("night") }
        try tab("Map")
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
        // REVIEW4_CHECK §4.3: "opening" is the welcome itself, shot once its Start is on screen (on a timer it caught the
        // black and the launch lockup before the page drew), then the welcome again as its strip moves to its next calls
        let welcome = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Welcome to Vetta")).firstMatch
        let go = web.buttons["Start"]
        XCTAssertTrue(until(90) { welcome.exists && go.exists && go.isHittable }, "the welcome never came up")
        pause(0.5); shot("opening")
        // REVIEW5 §7.4: the welcome's strip is the first thing a new driver sees; it moves on every 1.8 s through five demo
        // calls (web/cockpit.js OB_NOTES, runOnboarding), so one full cycle and the first call again, photographed on the
        // strip's own beat (from the opening, not from the last photo, so the time a photo takes doesn't drift the beat)
        let beat = Date()
        for k in 1...6 {
            let at = beat.addingTimeInterval(Self.WELCOME_BEAT * Double(k))
            if at > Date() { pause(at.timeIntervalSinceNow) }
            shot("welcome-\(k)")
        }
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
        try closeReplay()                                            // §4.4: the tab steps photographed the replay
        try tab("Log"); shot("log"); scroll(3, "log")
        try tab("Map")
        // People (the owner, 2026-10-30): Friends first, then the switch's other side, Crews
        try tab("People"); shot("friends"); scroll(3, "friends")
        if tap("Crews", wait: 4) { shot("crews"); scroll(3, "crews"); tap("Friends", wait: 3) }
        try tab("Garage"); shot("garage"); scroll(8, "garage")
        // Roadbook at night (§6.2): the Garage's Night detent (the Garage is still open: its tab again would close it), then the map
        for _ in 0..<8 where find(["Night"], wait: 1) == nil { app.swipeUp(velocity: .slow); pause(0.8) }
        if tap("Night", wait: 4) { try tab("Map"); pause(3); shot("roadbook-night") }
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
                pause(3); shot("route")                            // U-70: the card opens by itself
                // REVIEW4_CHECK §4.5: the bar is a toggle, so tapping it on the open card closed it, and a swipe on the map
                // never reached the bar's drag. The card's own Drive it key being on screen says it is open.
                let driveIt = web.buttons["Drive it"]
                let cardOpen = { driveIt.exists && driveIt.isHittable }
                if !cardOpen(), bar.exists && bar.isHittable { bar.tap(); pause(2) }
                shot("route-card"); scroll(3, "route-card")
                if cardOpen(), bar.exists && bar.isHittable { bar.tap(); pause(1.5) }
                shot("route-bar")                                  // closed: the bar alone over the map
                if bar.exists && bar.isHittable {                  // dragged open by its bar, as a thumb does
                    bar.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
                        .press(forDuration: 0.15, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.15)))
                }
                let dragged = until(4, cardOpen)
                XCTAssertTrue(dragged, "dragging the route bar up did not open the card")
                if !dragged, bar.exists && bar.isHittable { bar.tap() }
                pause(1.5); shot("route-card-open")
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
        // REVIEW5 §7.5: landscape on a corner call and on the quiet line (six frames at one moment last time); §7.8: the
        // home screen's island during the quiet line as well as during a note
        driveTo(Self.CORNER_CALL)
        landscape(16, "landscape-corner")
        driveTo(Self.QUIET_LINE)
        landscape(10, "landscape-quiet")
        homeScreen("home-quiet-line")
        driveTo(5)                                                 // the ramp, the junction and the first corners
        // U-94: in review mode the report is the member's sheet, Undo and pin, and never reaches the server. REVIEW5 §7.5:
        // the sheet once on its side too, then upright for the report itself. Recording 6: looking for the Report key with the
        // phone on its side mid-drive timed out XCUITest's snapshot and ended the flow at step 24, so the key is found upright,
        // by its own name in one query, and the phone turns once the sheet is up.
        let report = web.buttons.matching(NSPredicate(format: "label == %@", "Report a hazard")).firstMatch
        if until(6, { report.exists && report.isHittable }) {
            report.tap(); pause(1.5)
            XCUIDevice.shared.orientation = .landscapeLeft; pause(3)
            shot("report-sheet-landscape")
            XCUIDevice.shared.orientation = .portrait; pause(3)
            shot("report-sheet")
            let kind = web.buttons.matching(NSPredicate(format: "label IN %@", ["Gravel", "Pothole"])).firstMatch
            if until(4, { kind.exists && kind.isHittable }) { kind.tap() }
            pause(1); shot("reported")                             // the car's pin and alert a second after (§6.8)
        }
        // REVIEW4_CHECK §4.6: New Biddinger Road's turnaround (where the route doubles back, U-90) and back, then the home
        // screen, the island and the phone on its side from 13.4 min: the R5- at 31.1 km and the run of corners after it,
        // so they are photographed with a note up (the drive reaches 31.14 km at 13.7 min and 32.1 km at 14.4)
        driveTo(13.4)
        // the Live Activity in the Dynamic Island, from the home screen, and expanded by a long press (§6.7)
        XCUIDevice.shared.press(.home); pause(4); shot("home-live-activity")
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0)).withOffset(CGVector(dx: 0, dy: 30)).press(forDuration: 1.2)
        pause(2); shot("island-expanded")
        XCUIDevice.shared.press(.home); pause(4); shot("home-live-activity-later")
        app.activate(); pause(4); shot("back-in-app")
        lockScreen("lock-screen-live-activity")                   // REVIEW5 §7.9
        landscape(30, every: 5, "landscape")
        driveTo(18.5)                                              // Dry Ridge Rd's corners, to the last at 34.1 km (17.7 min)
        // REVIEW5 §7.1: the last recording's replay ran at a third of real speed and never reached End; the replay now runs
        // on the clock (ApexReplay), and the flow fails if the drive didn't end
        XCTAssertTrue(endDrive(), "the guided drive never reached End (no end card)")
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
            carEnd.tap(); pause(1.5); shot("drive-ending-from-car"); pause(6); shot("drive-ended-from-car")
        } else {
            endDrive()
        }
        tap("Done", wait: 4); pause(3); shot("after")
        // R-5 (panel round 1): the map comes back whole after a car-started drive: Where to? and Start, not a 2 px deck
        let whereTo = web.searchFields.firstMatch, go = web.buttons["Start drive"]
        XCTAssertTrue(until(8) { whereTo.exists && whereTo.isHittable && go.exists && go.isHittable }, "after the drive the deck (Where to? and Start) is not back")
    }

    func test06TapedeckNight() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("tapedeck-night", route: true, from: Self.TWISTIES)
        try theme("Tapedeck", night: true, route: true)
        pause(15)
        startDrive()
        driveFor(60, every: 10, "interstate")
        driveFor(300)
        endDrive()
        driveInLog(scrolls: 1, replay: true)
    }

    func test07Billet() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        // REVIEW4_CHECK §4.7 (U-86): this drive stands still in the R3- at 25.3 km (5.1 min in) for 8 s; the photos every 3 s
        // show the strip move on from the corner the car waits in (app-log.txt: "replay standing")
        start("billet", route: true, from: Self.TWISTIES, hold: Self.STANDSTILL)
        try theme("Billet", night: false, route: true)
        pause(15)
        startDrive()
        driveFor(60, every: 10, "interstate")
        driveTo(6.2)
        endDrive()
        driveInLog(scrolls: 1, replay: true)
    }

    /// Signed in as the review account (APEX_REVIEW_SESSION): People (its Friends, then its Crews) and the account in the Garage.
    func test08SignedIn() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        try XCTSkipIf((env["APEX_REVIEW_SESSION"] ?? "").isEmpty, "needs the review account (REVIEW_SESSION secret)")
        start("signed-in")
        try tab("People")
        // REVIEW4 §6.5 (U-66): the member's page, not the sign-in page, before anything is photographed; nothing here may
        // tap into "Sign in with Google" (the last recording's stray tap opened Google's sheet)
        let signedOut = { self.find(["Sign in with Google", "Sign in with Apple"], wait: 0.5) != nil }
        let member = until(30) { !signedOut() }
        XCTAssertTrue(member, "People still shows the sign-in page: the review session did not sign in")
        pause(3); shot("friends")
        guard member else { return }
        scroll(3, "friends")
        // the one Invite key: its sheet (invite link, my handle, requests), then Done
        if tap("Invite or add a friend", wait: 4) { pause(2); shot("invite"); tap("Done", wait: 3) }
        if tap("Crews", wait: 4) { pause(3); shot("crews"); scroll(5, "crews") }
        try tab("Garage"); shot("account"); scroll(6, "account")
        try tab("Map")
    }

    /// REVIEW5 §7.7: the largest accessibility text size. The cockpit's sizes are the theme contract's and must not change;
    /// the Garage, People, the route card and the Log's prose should grow. Launched with UIKit's own content-size argument,
    /// which is what the app (and WebKit's -apple-system text styles) read.
    func test09DynamicType() throws {
        try XCTSkipUnless(env["APEX_REVIEW"] == "1", "review recording only")
        start("dynamic-type", from: Self.TWISTIES, args: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        shot("map")
        startDrive()
        driveFor(20, every: 10, "cockpit")                         // the cockpit: unchanged
        endDrive()
        driveInLog(scrolls: 2, replay: false)                      // the Log's page of that drive: its prose
        try tab("Log"); shot("log")
        try tab("Garage"); shot("garage")
        // R-5 / I-6 (panel round 1): recording 6 drew the drive's end card over the Garage; a tab closes it
        XCTAssertNil(find(["Open in the Log"], wait: 1), "the drive's end card is over the Garage")
        scroll(3, "garage")
        try tab("People"); shot("people"); scroll(2, "people")
        try tab("Map")
        let search = web.searchFields.firstMatch
        if search.waitForExistence(timeout: 10) {
            search.tap(); pause(2)
            search.typeText("Winton Woods"); pause(6)
            if let place = findButton(startingWith: "Winton Woods", wait: 8) {
                place.tap()
                let driveIt = web.buttons["Drive it"]
                if until(45, { driveIt.exists && driveIt.isHittable }) { pause(2); shot("route-card"); scroll(2, "route-card") }
            }
        }
    }
}
