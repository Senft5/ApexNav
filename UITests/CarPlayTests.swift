import XCTest

/// The car's screen in the Simulator's CarPlay window, driven through its own accessibility (.github/workflows/carplay-shots.yml
/// opens the window, then runs this with APEX_CARPLAY=1). Clicking the window from the Mac never reached the car; XCUITest can:
/// the CarPlay home screen is the com.apple.CarPlayApp process and every template is drawn by com.apple.CarPlayTemplateUIHost,
/// so their icons and buttons are found by label, and XCUIScreen.screens[1] is the car's display. One app process for the whole
/// walk: CarPlay doesn't reconnect its scene to an app that XCUITest relaunches.
final class CarPlayTests: XCTestCase {
    private let home = XCUIApplication(bundleIdentifier: "com.apple.CarPlayApp")
    private let car = XCUIApplication(bundleIdentifier: "com.apple.CarPlayTemplateUIHost")

    override func setUp() {
        continueAfterFailure = true
        addUIInterruptionMonitor(withDescription: "Permissions") { alert in
            for label in ["Allow While Using App", "Allow Once", "Allow", "OK", "Continue"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
    }

    private func pause(_ s: Double) { RunLoop.current.run(until: Date().addingTimeInterval(s)) }

    /// The car's display, as an attachment kept with the run (the workflow exports them as the artifact).
    private func photo(_ name: String) {
        guard XCUIScreen.screens.count > 1 else { return }
        let a = XCTAttachment(screenshot: XCUIScreen.screens[1].screenshot())
        a.name = "carplay-\(name)"
        a.lifetime = .keepAlways
        add(a)
    }

    private func labelled(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch
    }

    /// Taps the first element with this label in the car, waiting for it; false when it never shows.
    @discardableResult
    private func tap(_ text: String, wait: Double = 30) -> Bool {
        let e = labelled(car, text)
        guard e.waitForExistence(timeout: wait) else { return false }
        e.tap()
        return true
    }

    func testCar() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["APEX_CARPLAY"] == "1", "CarPlay screenshots only")
        // the phone app, past the first-run screen (as AppTourTests)
        let app = XCUIApplication()
        // the real drive replayed (debug builds), and its road as the route: guidance moves along a real road
        app.launchEnvironment = ["APEX_REPLAY": "dry_ridge", "APEX_REVIEW": "1", "APEX_REVIEW_ROUTE": "1"]
        app.launch()
        app.tap()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 45))
        pause(4)
        for _ in 0..<5 {
            // the welcome's one key is "Start" (it runs in the app since U-65); Next/Get started were the old three screens
            let next = web.buttons["Next"], start = web.buttons["Get started"], welcome = web.buttons["Start"]
            if welcome.exists { welcome.tap(); break }
            if start.exists { start.tap(); break }
            if next.exists { next.tap() } else { break }
        }
        // the location sheet follows the welcome's Start (U-65): answer it, or the replayed drive never moves
        let sheet = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        if sheet.waitForExistence(timeout: 6) {
            for label in ["Allow While Using App", "Allow Once", "Allow"] where sheet.buttons[label].exists { sheet.buttons[label].tap(); break }
        }
        for _ in 0..<60 where XCUIScreen.screens.count < 2 { pause(1) }
        XCTAssertGreaterThan(XCUIScreen.screens.count, 1, "no CarPlay display")
        photo("01-home")

        // Vetta's icon on the car's home screen (it shows a minute or two after the phone app starts)
        let icon = labelled(home, "Vetta")
        XCTAssertTrue(icon.waitForExistence(timeout: 180), "no Vetta icon on the CarPlay home screen")
        icon.tap()
        XCTAssertTrue(labelled(car, "Loops").waitForExistence(timeout: 30), "Vetta didn't open in the car")
        pause(10)                                                   // map tiles
        photo("02-idle-map")

        // the Loops list (not chosen: the route is the replayed road), then that road's trip preview and a guided drive
        if tap("Loops") { pause(2); photo("03-loops-list"); tap("Back", wait: 5) }
        // The idle map has a Drive key of its own (U-79), so the preview is found by its card's words ("186 corners", U-89)
        // before its Drive is tapped; the bar's Drive steps aside while a preview is up.
        let preview = car.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "corners")).firstMatch
        if preview.waitForExistence(timeout: 90), labelled(car, "Drive").exists {
            pause(6)
            photo("04-trip-preview")
            tap("Drive")
            for k in 0..<16 { pause(8); photo(String(format: "05-drive-%02d", k)) }
            tap("End", wait: 10)
            pause(4)
            photo("06-ended")                                       // the idle map, no preview of the finished route (U-62)
        } else {
            photo("04-no-trip-preview")
        }
        // a free drive started and ended from the car (U-59, U-79): Drive on the idle map, the record card, End
        if tap("Drive", wait: 10) {
            pause(8); photo("06a-free-drive")
            tap("End", wait: 10)
            pause(4); photo("06b-free-drive-ended")
        }
        // the other two keys, from the idle map
        if tap("Places", wait: 10) { pause(2); photo("07-places"); car.navigationBars.buttons.firstMatch.tap() }
        if tap("Where to?", wait: 10) { pause(2); photo("08-where-to") }
        XCTAssertNotEqual(app.state, .notRunning, "the phone app is still running")
    }
}
