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
        // Since U-65 the first-run welcome runs in the app and its Start brings up the system location sheet, which
        // the old "Get started" tap never met: start past the welcome as the review recordings do (debug builds).
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

        XCTAssertTrue(web.buttons["Garage"].waitForExistence(timeout: 45), "cockpit JS did not boot")
        for tab in ["Map", "Log", "People"] {
            XCTAssertTrue(web.buttons[tab].waitForExistence(timeout: 5), "tab \(tab) missing")
        }

        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "cockpit"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
