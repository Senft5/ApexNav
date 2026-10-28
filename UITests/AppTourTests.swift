import XCTest

/// A slow walk through the real app for the recorded review tour (.github/workflows/app-tour.yml records the simulator's
/// screen while this runs and simctl plays a GPS drive). Skipped in normal test runs: it only runs with APEX_TOUR=1.
final class AppTourTests: XCTestCase {
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

    private func scroll(_ app: XCUIApplication, times: Int) {
        for _ in 0..<times { app.swipeUp(velocity: .slow); pause(1.2) }
        for _ in 0..<times { app.swipeDown(velocity: .fast) }
        pause(1)
    }

    /// Launches the app and walks the first-run onboarding if it shows.
    private func launch() -> (XCUIApplication, XCUIElement) {
        let app = XCUIApplication()
        app.launch()
        app.tap()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 45))
        pause(4)
        for _ in 0..<5 {
            let next = web.buttons["Next"], start = web.buttons["Get started"]
            if start.exists { pause(2); start.tap(); break }
            if next.exists { pause(2.5); next.tap() } else { break }
        }
        pause(3)
        return (app, web)
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    /// Every text field on every tab with the real keyboard up (review 2026-10-28): a screenshot of each, and the field must
    /// sit above the keyboard. The workflow turns the simulator's hardware keyboard off so the on-screen one shows.
    func testKeyboard() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["APEX_TOUR"] == "1", "recorded tour only")
        let (app, web) = launch()
        for tab in ["Map", "Log", "Stages", "Crew", "Settings"] {
            let b = web.buttons[tab]
            guard b.waitForExistence(timeout: 10) else { continue }
            b.tap(); pause(2.5)
            let fields = web.descendants(matching: .any).matching(NSPredicate(format: "elementType IN %@",
                [XCUIElement.ElementType.textField.rawValue, XCUIElement.ElementType.searchField.rawValue, XCUIElement.ElementType.textView.rawValue].map { NSNumber(value: $0) }))
            for i in 0..<min(fields.count, 12) {
                let f = fields.element(boundBy: i)
                guard f.exists, f.isHittable else { continue }
                let label = [f.label, f.placeholderValue ?? ""].first { !$0.isEmpty } ?? "field \(i)"
                f.tap(); pause(1.5)
                let kb = app.keyboards.firstMatch
                if kb.exists {
                    XCTAssertLessThanOrEqual(f.frame.maxY, kb.frame.minY + 1, "\(tab) · \(label): the field is under the keyboard")
                }
                shot(app, "\(tab) · \(label)")
                // put the keyboard away without submitting: tap the very top of the screen
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.04)).tap(); pause(1)
            }
        }
    }

    func testTour() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["APEX_TOUR"] == "1", "recorded tour only")
        let (app, web) = launch()
        for tab in ["Log", "Stages", "Crew", "Settings"] {
            let b = web.buttons[tab]
            if b.waitForExistence(timeout: 10) { b.tap(); pause(2.5); scroll(app, times: 5) }
        }
        if web.buttons["Map"].exists { web.buttons["Map"].tap(); pause(2) }
        // plan a route by search (the simulator's location is the start)
        let search = web.searchFields.firstMatch
        if search.waitForExistence(timeout: 10) {
            search.tap(); pause(1.5)
            search.typeText("Robbinsville"); pause(6)
            let place = web.staticTexts["Robbinsville"].firstMatch
            if place.exists { place.tap(); pause(25) }
            let drive = web.buttons["Drive it"], start = web.buttons["Start"]
            if drive.exists { drive.tap() } else if start.exists { start.tap() }
            pause(3)
            if web.buttons["Allow and start"].exists { web.buttons["Allow and start"].tap(); app.tap() }
            pause(90)   // simctl drives the route meanwhile: directions, notes, the Live Activity
            if web.buttons["End drive"].exists { web.buttons["End drive"].tap(); pause(6) }
        }
        shot(app, "end of tour")
    }
}
