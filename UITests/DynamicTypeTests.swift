import XCTest

/// The phone's own text size reaches the web page inside the app (IDEAS U-15). Every large-text e2e flow fakes the size
/// in Chromium (TYPE_AT in e2e/smoke.js); this is the one place the real path runs: iOS's content size category ->
/// WebKit's `-apple-system-body` -> web/format.js applyTypeScale -> the reading pages zoom.
///
/// At the largest accessibility size the Units sheet's "Kilometres and metres" key grows past twice its 1x height
/// (a 44 pt key at 1x; at 2x it zooms and wraps, #932), so one launch at that size is enough to tell.
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

        let gear = web.buttons["Settings"]
        XCTAssertTrue(gear.waitForExistence(timeout: 10), "the Garage's Settings key is missing")
        gear.tap()
        let units = web.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Units'")).firstMatch
        XCTAssertTrue(units.waitForExistence(timeout: 10), "Settings has no Units row")
        units.tap()

        let km = web.buttons.matching(NSPredicate(format: "label CONTAINS 'Kilometres'")).firstMatch
        XCTAssertTrue(km.waitForExistence(timeout: 10), "the Units sheet has no Kilometres key")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "units-at-largest-text"
        shot.lifetime = .keepAlways
        add(shot)
        XCTAssertGreaterThan(km.frame.height, 70, "at the largest text size the Kilometres key is \(km.frame.height) pt tall: the page did not zoom")
        XCTAssertLessThanOrEqual(km.frame.maxX, app.frame.maxX + 1, "the Kilometres key runs off the screen")
    }
}
