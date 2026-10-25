import XCTest

/// Launches the real app on a simulator and proves the shared web cockpit loads inside the
/// native shell (bundle resources, WKWebView, JS boot), then attaches a screenshot.
final class CockpitSmokeTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "Location / motion permission") { alert in
            for label in ["Allow While Using App", "Allow Once", "OK", "Allow"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
    }

    func testCockpitLoadsInsideTheApp() {
        let app = XCUIApplication()
        app.launch()
        app.tap()   // lets the interruption monitor handle the permission alert

        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 30), "WKWebView never appeared")
        // The mode plate and route key are rendered by web/index.html once the drive loads.
        XCTAssertTrue(web.staticTexts["REPLAY"].waitForExistence(timeout: 45), "cockpit JS did not boot")
        XCTAssertTrue(web.buttons["ROUTE"].exists || web.staticTexts["ROUTE"].exists)

        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "cockpit"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
