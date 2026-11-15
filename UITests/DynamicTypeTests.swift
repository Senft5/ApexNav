import XCTest

/// The phone's own text size reaches the web page inside the app (IDEAS U-15). Every large-text e2e flow fakes the size
/// in Chromium (TYPE_AT in e2e/smoke.js); this is the one place the real path runs: iOS's content size category ->
/// WebKit's `-apple-system-body` -> web/format.js applyTypeScale -> the reading pages zoom.
///
/// At the largest accessibility size the Garage zooms 2x: its Haptics switch row, 48 pt at 1x, is about 96 pt, so one
/// launch at that size is enough to tell.
final class DynamicTypeTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testLargestTextSizeZoomsTheReadingPages() {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launchEnvironment["APEX_REVIEW"] = "1"
        app.launchEnvironment["APEX_REVIEW_PAST_WELCOME"] = "1"
        app.launch()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let sheet = springboard.alerts.firstMatch
        if sheet.waitForExistence(timeout: 8) {
            for label in ["Allow While Using App", "Allow Once", "Allow"] where sheet.buttons[label].exists { sheet.buttons[label].tap(); break }
        }

        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 30), "WKWebView never appeared")
        let garage = web.buttons["Garage"]
        XCTAssertTrue(garage.waitForExistence(timeout: 45), "cockpit JS did not boot")
        garage.tap()

        // the Garage's Haptics switch: a 48 pt row at 1x; at 2x the sheet zooms it to about 96 (seen on the simulator,
        // 2026-11-15: every key in the Garage was twice its height)
        let haptics = web.switches["Haptics"]
        XCTAssertTrue(haptics.waitForExistence(timeout: 10), "the Garage has no Haptics switch")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "garage-at-largest-text"
        shot.lifetime = .keepAlways
        add(shot)
        XCTAssertGreaterThan(haptics.frame.height, 70, "at the largest text size the Haptics row is \(haptics.frame.height) pt tall: the page did not zoom")
        XCTAssertLessThanOrEqual(haptics.frame.maxX, app.frame.maxX + 1, "the Haptics row runs off the screen")
    }
}
